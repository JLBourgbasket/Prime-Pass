import type { SupabaseClient } from '@supabase/supabase-js'
export type NotificationResult = 'sent' | 'failed' | 'unchanged'
export type Notify = (db: SupabaseClient,id: string,actor?: string,retry?: boolean)=>Promise<NotificationResult>
export type Mail = { from: { name: string; address: string }; to: string; replyTo: string; subject: string; text: string; messageId: string }
export type SendMail = (mail: Mail)=>Promise<void>
export function createNotifier(send:SendMail, env:(key:string)=>string|undefined):Notify {
 return async(db,id,actor,retry=false)=>{
  const rpc=async(action:string,data:Record<string,unknown>)=>{const r=await db.rpc('prime_pass_notification',{p_actor:actor||null,p_action:action,p_data:{id,...data}});if(r.error)throw r.error;return r.data}
  const claim=await rpc('claim',{retry});if(!claim)return 'unchanged'
  let sent=false,error='smtp_failed'
  try {
   const from=env('SMTP_FROM')?.trim().toLowerCase(),to=env('SUBSCRIPTION_NOTIFY_TO')?.trim().toLowerCase()
   if(from!=='vip@primesportsante.fr'||to!=='vip@primesportsante.fr')throw {code:'CONFIG'}
   const s=claim.subscription, offer=s.offer==='company'?'Pass entreprise':s.offer==='director'?'VIP dirigeant / TNS':'VIP individuel'
   const participants=(s.participants||[]).map((p:{first_name:string;last_name:string;duo:boolean;duo_first_name?:string;duo_last_name?:string},i:number)=>`${i+1}. ${p.first_name} ${p.last_name}${p.duo?` — duo : ${p.duo_first_name} ${p.duo_last_name}`:''}`)
   const site=env('SITE_URL')||'https://deploy-preview-1--primepassentreprise.netlify.app'
   await send({from:{name:'Prime Sport Santé',address:from},to,replyTo:s.email,subject:`Prime VIP — nouvelle souscription ${id.slice(0,8).toUpperCase()}`,messageId:`<subscription-${id}@primesportsante.fr>`,text:[
    'Nouvelle demande de souscription Prime VIP',`Référence : ${id}`,`Offre : ${offer}`,s.company_name?`Entreprise : ${s.company_name}`:'',`Contact : ${s.contact_name}`,`E-mail : ${s.email}`,`Téléphone : ${s.phone}`,`Quantité : ${s.quantity}`,`Montant annuel demandé : ${Number(s.total_amount).toFixed(2)} € ${s.tax_basis}`,...participants,'','Statut : demande enregistrée, à traiter par Prime. Aucun règlement confirmé.',`Consulter dans Administration → Souscriptions : ${site}/?view=subscriptions`].filter(Boolean).join('\n')})
   sent=true
  } catch(e) {
   const code=e&&typeof e==='object'&&'code' in e?String(e.code):''
   error=code==='CONFIG'?'smtp_config':code==='EAUTH'?'smtp_auth':['ETIMEDOUT','ECONNECTION','ESOCKET','EDNS'].includes(code)?'smtp_connection':code==='EENVELOPE'?'smtp_rejected':'smtp_failed'
  }
  // Only sanitized error categories are stored. Never log SMTP credentials or full SMTP replies.
  await rpc('finish',{token:claim.token,sent,error})
  return sent?'sent':'failed'
 }
}
