import type { SupabaseClient } from '@supabase/supabase-js'
type Factory = (url: string, key: string, options: { auth: { persistSession: boolean; autoRefreshToken: boolean } }) => SupabaseClient
export function createSubscriptionHandler(createClient: Factory, env: (key: string) => string | undefined) {
 const origins = new Set([env('SITE_URL') || 'https://primepassentreprise.netlify.app','https://deploy-preview-1--primepassentreprise.netlify.app'])
 return async (req: Request) => {
  const origin=req.headers.get('origin')
  const headers = { 'Access-Control-Allow-Origin': origin && origins.has(origin) ? origin : 'https://primepassentreprise.netlify.app', 'Access-Control-Allow-Headers':'apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS',Vary:'Origin','Content-Type':'application/json','Cache-Control':'no-store' }
  const json=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers})
  if(origin && !origins.has(origin)) return json({error:'Origine non autorisée'},403)
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers})
  if(!['GET','POST'].includes(req.method)) return json({error:'Méthode non autorisée'},405)
  const url=env('SUPABASE_URL'), secret=JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}').default || env('SUPABASE_SERVICE_ROLE_KEY')
  if(!url || !secret) return json({error:'Souscription indisponible. Réessayez plus tard.'},503)
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  try {
   let data: Record<string,unknown>={}
   if(req.method==='POST') {
    if(Number(req.headers.get('content-length') || 0)>32000) return json({error:'Demande trop volumineuse'},413)
    const body=await req.text();if(body.length>32000) return json({error:'Demande trop volumineuse'},413)
    try { data=JSON.parse(body);if(!data || typeof data!=='object' || Array.isArray(data)) throw Error() } catch {return json({error:'Demande invalide'},400)}
    const ip=(req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim()
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip))
    // Only server-derived abuse signal; callers cannot choose their action or actor.
    data.ip_hash=Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('')
   }
   const result=await db.rpc('prime_pass_subscriptions',{p_actor:null,p_action:req.method==='GET'?'campaign':'submit',p_data:data})
   if(result.error) throw result.error
   return json(result.data)
  } catch(e) {
   const message=e && typeof e==='object' && 'message' in e ? String(e.message) : ''
   const safe=/^(La campagne|Trop de demandes|Quantité invalide|Renseignez|Identité|Offre invalide)/.test(message) ? message : 'Vérifiez les informations saisies, puis réessayez.'
   return json({error:safe},message.startsWith('Trop de demandes')?429:400)
  }
 }
}
