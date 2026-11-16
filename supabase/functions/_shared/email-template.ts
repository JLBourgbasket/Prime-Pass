import { primeLogo } from './email-logo.ts'
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function brandedEmail(text:string,subscriber:boolean,adminUrl?:string){
 const title=subscriber?'Votre demande est bien reçue.':'Nouvelle demande de souscription.'
 const lines=text.split('\n').filter(line=>line!=='Nouvelle demande de souscription Prime VIP'&&!line.startsWith('Consulter dans Administration → Souscriptions :'))
 let body='',inSummary=false
 for(const line of lines){
  const match=line.match(/^(Référence|Offre|Entreprise|Contact|E-mail|Téléphone|Quantité|Montant annuel demandé) : (.*)$/)
  if(match){
   if(!inSummary){body+='<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f8fc;border:1px solid #e3eaf3;border-radius:12px;margin:20px 0;">';inSummary=true}
   body+=`<tr><td style="padding:10px 18px;color:#63748a;font-size:13px;line-height:20px;vertical-align:top;width:38%;">${escapeHtml(match[1])}</td><td style="padding:10px 18px 10px 0;color:#122841;font-size:15px;line-height:22px;overflow-wrap:anywhere;">${escapeHtml(match[2])}</td></tr>`
  }else{
   if(inSummary){body+='</table>';inSummary=false}
   if(line)body+=`<p style="margin:0 0 14px;font-size:15px;line-height:25px;color:#354860;overflow-wrap:anywhere;">${escapeHtml(line)}</p>`
  }
 }
 if(inSummary)body+='</table>'
 let button=''
 if(!subscriber&&adminUrl){try{const url=new URL(adminUrl);if(url.protocol==='https:')button=`<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;"><tr><td bgcolor="#1564c8" style="border-radius:8px;"><a href="${escapeHtml(url.href)}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Consulter la souscription</a></td></tr></table>`}catch{/* No invalid link is rendered. */}}
 const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background:#f3f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;">${title} Prime Sport Santé vous accompagne.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6fa;"><tr><td align="center" style="padding:28px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e1e8f0;border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;"><tr><td align="center" style="padding:30px 24px 24px;border-bottom:1px solid #edf1f7;"><img src="cid:prime-logo@primesportsante.fr" width="180" height="122" alt="Prime Sport Santé" style="display:block;width:180px;max-width:100%;height:auto;border:0;"></td></tr><tr><td style="padding:30px 24px;"><p style="margin:0 0 12px;font-size:11px;line-height:18px;letter-spacing:2px;color:#1564c8;font-weight:700;">PRIME VIP</p><h1 style="margin:0 0 24px;font-size:27px;line-height:35px;letter-spacing:-0.5px;color:#0f253e;font-weight:650;">${title}</h1>${body}${button}</td></tr><tr><td style="padding:20px 24px;border-top:1px solid #edf1f7;color:#718096;font-size:12px;line-height:20px;">Prime Sport Santé<br><a href="mailto:vip@primesportsante.fr" style="color:#1564c8;text-decoration:none;">vip@primesportsante.fr</a></td></tr></table></td></tr></table></body></html>`
 return{html,attachments:[{filename:'prime-sport-sante.png',content:primeLogo,encoding:'base64',contentType:'image/png',contentDisposition:'inline',cid:'prime-logo@primesportsante.fr'}]}
}
