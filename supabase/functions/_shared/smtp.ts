import nodemailer from 'npm:nodemailer@10.2.1'
import { createNotifier } from './notifications.ts'
export const notify = createNotifier(async mail=>{
 const env=(key:string)=>Deno.env.get(key)
 const host=env('SMTP_HOST'),user=env('SMTP_USER'),pass=env('SMTP_PASSWORD'),port=Number(env('SMTP_PORT'))
 if(!host||!user||!pass||port!==465)throw {code:'CONFIG'}
 const transport=nodemailer.createTransport({host,port,secure:true,auth:{user,pass:pass.replace(/\s/g,'')},connectionTimeout:12000,greetingTimeout:12000,socketTimeout:20000,tls:{minVersion:'TLSv1.2'},disableFileAccess:true,disableUrlAccess:true})
 try {const r=await transport.sendMail(mail);if(!r.accepted?.length)throw {code:'EENVELOPE'}} finally {transport.close()}
},key=>Deno.env.get(key))
