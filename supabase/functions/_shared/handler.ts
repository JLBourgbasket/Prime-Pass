import type { Notify } from './notifications.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
type ClientFactory = (url: string, key: string, options: { auth: { persistSession: boolean; autoRefreshToken: boolean } }) => SupabaseClient

export function createHandler(createClient: ClientFactory, env: (key: string) => string | undefined, notify?: Notify) {
const siteUrl = env('SITE_URL') || 'https://primepassentreprise.netlify.app'
const allowedOrigins = new Set([siteUrl, 'https://deploy-preview-1--primepassentreprise.netlify.app'])
const allowed = new Set(['lifecycle_archive_company','lifecycle_archive_vip','lifecycle_restore_company','lifecycle_restore_vip','lifecycle_purge_company','lifecycle_purge_vip','subscriptions_receipt', 'subscriptions_notify', 'subscriptions_list', 'subscriptions_campaign', 'subscriptions_decline', 'subscriptions_activate', 'save_vip', 'snapshot', 'create_company', 'update_company', 'add_contract', 'update_contract', 'add_beneficiary', 'update_beneficiary', 'claim', 'cancel_claim', 'record_cryo', 'void_cryo', 'send_access_link'])

return async (request: Request) => {
  const origin = request.headers.get('origin')
const cors = { 'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : siteUrl, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
})
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origine non autorisée' }, 403)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)
  const url = env('SUPABASE_URL')
  const secret = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default || env('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !secret) return json({ error: 'Configuration serveur incomplète. Contactez Prime.' }, 503)
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) return json({ error: 'Connexion requise' }, 401)
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: auth, error: authError } = await admin.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Session expirée. Reconnectez-vous.' }, 401)
  const length = Number(request.headers.get('content-length') || 0)
  if (length > 500_000) return json({ error: 'Fichier trop volumineux' }, 413)
  let input: { action: string; data?: Record<string, unknown> }
  try {
    const body = await request.text()
    if (body.length > 500_000) return json({ error: 'Fichier trop volumineux' }, 413)
    input = JSON.parse(body)
    if (!input || !allowed.has(input.action) || (input.data && (typeof input.data !== 'object' || Array.isArray(input.data)))) throw new Error()
  } catch { return json({ error: 'Requête invalide' }, 400) }
  const rpc = async (action: string, data: Record<string, unknown> = {}) => {
    const result = await admin.rpc('prime_pass_execute', { p_actor: auth.user.id, p_action: action, p_data: data })
    if (result.error) throw result.error
    return result.data
  }
  try {
    const lifecycle = async (action: string, data: Record<string, unknown> = {}) => {
      const r=await admin.rpc('prime_pass_lifecycle',{p_actor:auth.user.id,p_action:action,p_data:data});if(r.error)throw r.error;return r.data
    }
    const cleanup = async () => {
      const users=await lifecycle('cleanup_list') as string[]
      for(const user_id of users){const r=await admin.auth.admin.deleteUser(user_id);if(!r.error || r.error.status===404 || r.error.code==='user_not_found')await lifecycle('cleanup_done',{user_id})}
    }
    if(input.action.startsWith('lifecycle_')){
      const result=await lifecycle(input.action.slice(10),input.data)
      let cleanupPending=false
      if(input.action==='lifecycle_purge_company') { try{await cleanup();const remaining=await lifecycle('cleanup_list') as string[];cleanupPending=remaining.some(id=>(result.auth_users || []).includes(id))}catch{cleanupPending=true} }
      return json({...result,notice:cleanupPending?'Fiche supprimée. La suppression du compte de connexion reste en cours de finalisation.':input.action.includes('purge')?'Fiche supprimée définitivement.':input.action.includes('archive')?'Fiche déplacée vers Clients désactivés.':'Client réactivé avec un nouveau contrat.'})
    }
    if(input.action==='snapshot'){
      const result=await rpc('snapshot');if(result.account.role==='prime_admin'){try{await cleanup()}catch{/* Keep the console available during an Auth outage. */}}return json(result)
    }
    if (input.action.startsWith('subscriptions_')) {
      const srpc = async (action: string, data: Record<string, unknown> = {}) => {
        const r = await admin.rpc('prime_pass_subscriptions', { p_actor: auth.user.id, p_action: action, p_data: data }); if (r.error) throw r.error; return r.data
      }
      const data = input.data || {}
      if (input.action === 'subscriptions_list') return json(await srpc('list'))
      if (input.action === 'subscriptions_campaign') return json(await srpc('set_campaign', data))
      if (input.action === 'subscriptions_decline') return json(await srpc('decline', data))
      const sub = await srpc('get', { id: data.id })
      if (input.action === 'subscriptions_notify' || input.action === 'subscriptions_receipt') {
        if(!notify) return json({error:'Envoi indisponible'},503)
        const subscriber=input.action==='subscriptions_receipt'
        const status=await notify(admin,sub.id,auth.user.id,true,subscriber?'subscriber':'internal')
        return json({ok:true,notice:status==='sent'?(subscriber?'Accusé de réception envoyé au souscripteur.':'Notification envoyée à vip@primesportsante.fr.'):status==='unchanged'?'Notification déjà envoyée ou tentative en cours.':'Échec de l’envoi. La demande reste enregistrée ; consultez l’état de notification.'})
      }
      if (sub.status !== 'pending') return json({ error: 'Cette demande a déjà été traitée.' }, 400)
      let userId: string | undefined
      if (sub.offer === 'company') {
        const created = await admin.auth.admin.createUser({ email: sub.email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true })
        if (created.error || !created.data.user) throw created.error || new Error('Création impossible')
        userId = created.data.user.id
      }
      let result
      try { result = await srpc('activate', { ...data, auth_user_id: userId }) }
      catch(e) { if (userId) await admin.auth.admin.deleteUser(userId); throw e }
      if (userId) {
        const mail = await admin.auth.resetPasswordForEmail(sub.email, { redirectTo: origin && allowedOrigins.has(origin) ? origin : siteUrl })
        return json({ ...result, notice: mail.error ? 'Contrat activé. Renvoyez le lien de mot de passe depuis la fiche entreprise.' : 'Contrat activé. Lien de définition du mot de passe demandé par e-mail.' })
      }
      return json({ ...result, notice: 'Souscription activée et ajoutée aux VIP.' })
    }
    if (input.action === 'create_company' || input.action === 'send_access_link') {
      const snapshot = await rpc('snapshot')
      if (snapshot.account.role !== 'prime_admin') return json({ error: 'Action réservée à Prime' }, 403)
      if (!siteUrl || !/^https:\/\//.test(siteUrl)) return json({ error: 'SITE_URL doit être configurée côté serveur pour envoyer les liens de connexion.' }, 503)
      if (input.action === 'send_access_link') {
        const company = snapshot.companies.find((c: { id: string }) => c.id === input.data?.company_id)
        if (!company) return json({ error: 'Entreprise introuvable' }, 404)
        const result = await admin.auth.resetPasswordForEmail(company.email, { redirectTo: origin && allowedOrigins.has(origin) ? origin : siteUrl })
        if (result.error) throw result.error
        return json({ ok: true })
      }
      const data = input.data || {}
      if (!/^[0-9a-f-]{36}$/i.test(String(data.request_id))) return json({ error: 'Identifiant de création invalide' }, 400)
      const existing = await rpc('creation_status', { request_id: data.request_id })
      if (existing) return json({ ok: true, company: existing, notice: 'Compte déjà créé. Vous pouvez renvoyer le lien d’accès depuis sa fiche.' })
      const email = String(data.email || '').trim().toLowerCase()
      const created = await admin.auth.admin.createUser({ email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true })
      if (created.error || !created.data.user) throw created.error || new Error('Création impossible')
      let company
      try { company = await rpc('create_company', { ...data, email, auth_user_id: created.data.user.id }) }
      catch (error) {
        // Roll back only the auth account created by this request; existing users are never reassigned.
        await admin.auth.admin.deleteUser(created.data.user.id)
        throw error
      }
      const mail = await admin.auth.resetPasswordForEmail(email, { redirectTo: origin && allowedOrigins.has(origin) ? origin : siteUrl })
      return json({ ok: true, company, notice: mail.error ? 'Entreprise créée. Le lien d’accès n’a pas pu être envoyé ; renvoyez-le depuis sa fiche.' : 'Entreprise créée. Lien de définition du mot de passe demandé par e-mail.' })
    }
    return json(await rpc(input.action, input.data))
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Opération impossible'
    // Operational details and credentials must never be returned to the browser.
    const safe = message.includes('already been registered') ? 'Cette adresse e-mail possède déjà un compte. Utilisez une autre adresse ou contactez Prime.'
      : /relation .* does not exist|Could not find the function/.test(message) ? 'La base Prime Pass doit être installée sur ce projet.'
      : /violates|invalid input|null value|out of range/.test(message) ? 'Vérifiez les champs saisis et les valeurs du contrat.' : message
    return json({ error: safe }, 400)
  }
}

}
