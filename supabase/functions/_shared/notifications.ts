import { brandedEmail } from './email-template.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
export type NotificationResult = 'sent' | 'failed' | 'unchanged'
export type NotificationTarget = 'internal' | 'subscriber' | 'both'
export type Notify = (db: SupabaseClient,id: string,actor?: string,retry?: boolean,target?: NotificationTarget)=>Promise<NotificationResult>
export type Mail = { from: { name: string; address: string }; to: string; replyTo: string; subject: string; text: string; messageId: string; html?: string; attachments?: {filename:string;content:string;encoding:string;contentType:string;contentDisposition:string;cid:string}[] }
export type SendMail = (mail: Mail)=>Promise<void>
export function createNotifier(send:SendMail, env:(key:string)=>string|undefined):Notify {
 return async(db,id,actor,retry=false,target='both')=>{
  const outcomes:NotificationResult[]=[]
  for(const channel of (target==='both'?['internal','subscriber']:[target])){
  const rpc=async(action:string,data:Record<string,unknown>)=>{const r=await db.rpc(channel==='subscriber'?'prime_pass_receipt':'prime_pass_notification',{p_actor:actor||null,p_action:action,p_data:{id,...data}});if(r.error)throw r.error;return r.data}
  const claim=await rpc('claim',{retry});if(!claim){outcomes.push('unchanged');continue}
  let sent=false,error='smtp_failed'
  try {
   const from=env('SMTP_FROM')?.trim().toLowerCase(),to=env('SUBSCRIPTION_NOTIFY_TO')?.trim().toLowerCase()
   if(from!=='vip@primesportsante.fr'||to!=='vip@primesportsante.fr')throw {code:'CONFIG'}
   const s=claim.subscription, offer=s.offer==='company'?'Pass entreprise':s.offer==='director'?'VIP dirigeant / TNS':'VIP individuel'
   const participants=(s.participants||[]).map((p:{first_name:string;last_name:string;duo:boolean;duo_first_name?:string;duo_last_name?:string},i:number)=>`${i+1}. ${p.first_name} ${p.last_name}${p.duo?` — duo : ${p.duo_first_name} ${p.duo_last_name}`:''}`)
   const site=env('SITE_URL')||'https://deploy-preview-1--primepassentreprise.netlify.app'
   const sendBranded=(mail:Mail)=>send({...mail,...brandedEmail(mail.text,channel==='subscriber',`${site}/?view=subscriptions`)})
   const summary=[`Référence : ${id}`,`Offre : ${offer}`,s.company_name?`Entreprise : ${s.company_name}`:'',`Quantité : ${s.quantity}`,`Montant annuel demandé : ${Number(s.total_amount).toFixed(2)} € ${s.tax_basis}`,...participants].filter(Boolean)
   if(channel==='subscriber'){
    await sendBranded({from:{name:'Prime Sport Santé',address:from},to:s.email,replyTo:from,subject:`Prime VIP — réception de votre demande ${id.slice(0,8).toUpperCase()}`,messageId:`<subscription-receipt-${id}@primesportsante.fr>`,text:[`Bonjour ${s.contact_name},`,'','Nous avons bien reçu votre demande de souscription Prime VIP.',...summary,'',s.status==='activated'?'Votre souscription a déjà été validée par Prime. Ce message récapitule votre demande initiale ; il ne constitue pas une nouvelle demande de paiement.':s.status==='declined'?'Pour connaître les suites données à votre demande, contactez notre équipe.':'Un lien de paiement vous sera envoyé ultérieurement par notre équipe. Votre abonnement sera activé après validation du règlement par Prime.','','Cet accusé de réception ne constitue pas une facture.',`Pour toute question, répondez à cet email : ${from}`,'','L’équipe Prime Sport Santé'].join('\n')})
   }else await sendBranded({from:{name:'Prime Sport Santé',address:from},to,replyTo:s.email,subject:`Prime VIP — nouvelle souscription ${id.slice(0,8).toUpperCase()}`,messageId:`<subscription-${id}@primesportsante.fr>`,text:[
    'Nouvelle demande de souscription Prime VIP',`Référence : ${id}`,`Offre : ${offer}`,s.company_name?`Entreprise : ${s.company_name}`:'',`Contact : ${s.contact_name}`,`E-mail : ${s.email}`,`Téléphone : ${s.phone}`,`Quantité : ${s.quantity}`,`Montant annuel demandé : ${Number(s.total_amount).toFixed(2)} € ${s.tax_basis}`,...participants,'','Statut : demande enregistrée, à traiter par Prime. Aucun règlement confirmé.',`Consulter dans Administration → Souscriptions : ${site}/?view=subscriptions`].filter(Boolean).join('\n')})
   sent=true
  } catch(e) {
   const code=e&&typeof e==='object'&&'code' in e?String(e.code):''
   error=code==='CONFIG'?'smtp_config':code==='EAUTH'?'smtp_auth':['ETIMEDOUT','ECONNECTION','ESOCKET','EDNS'].includes(code)?'smtp_connection':code==='EENVELOPE'?'smtp_rejected':'smtp_failed'
  }
  // Only sanitized error categories are stored. Never log SMTP credentials or full SMTP replies.
  await rpc('finish',{token:claim.token,sent,error})
  outcomes.push(sent?'sent':'failed')
  }
  return outcomes.includes('failed')?'failed':outcomes.includes('sent')?'sent':'unchanged'
 }
}
