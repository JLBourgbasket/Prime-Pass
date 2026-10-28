import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import {createNotifier} from '../supabase/functions/_shared/notifications.ts'
const db=new PGlite(),actor=randomUUID(),id=randomUUID()
const env=k=>({SMTP_FROM:'vip@primesportsante.fr',SUBSCRIPTION_NOTIFY_TO:'vip@primesportsante.fr'}[k])
const adapter={rpc:async(name,args)=>{try{return{data:(await db.query(`select public.${name}($1,$2,$3) r`,[args.p_actor,args.p_action,JSON.stringify(args.p_data)])).rows[0].r}}catch(e){return{error:e}}}}
before(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)')
 for(const f of ['prime_pass_v2.sql','vip_sales.sql','subscriptions.sql','admin_discounts.sql','subscription_notifications.sql','subscriber_receipts.sql']) await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'))
 await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into prime_pass.accounts(user_id,role) values($1,'prime_admin')",[actor]);await db.exec('set role service_role')
 await adapter.rpc('prime_pass_subscriptions',{p_actor:null,p_action:'submit',p_data:{id,offer:'company',company_name:'Test',contact_name:'Contact',email:'test@example.com',phone:'0102030405',quantity:1,participants:[],consent:true,ip_hash:'test'}})
})
after(()=>db.close())
test('failed SMTP does not lose subscription and stores no secret error text',async()=>{
 const notify=createNotifier(async()=>{throw{code:'EAUTH',message:'secret-password'}},env)
 assert.equal(await notify(adapter,id,undefined,false,'internal'),'failed');const row=(await db.query('select * from prime_pass.subscriptions where id=$1',[id])).rows[0];assert.equal(row.status,'pending');assert.equal(row.notification_status,'failed');assert.equal(row.notification_error,'smtp_auth');assert.equal(row.notification_attempts,1)
 assert.equal(await notify(adapter,id,undefined,false,'internal'),'unchanged')
})
test('only Prime retries and sent messages are not sent twice; content comes from stored request',async()=>{
 await db.query("update prime_pass.subscriptions set notification_attempted_at=now()-interval '2 minutes' where id=$1",[id])
 const mails=[],notify=createNotifier(async mail=>{mails.push(mail)},env)
 await assert.rejects(()=>notify(adapter,id,randomUUID(),true,'internal'),/réservée/)
 assert.equal(await notify(adapter,id,actor,true,'internal'),'sent');assert.equal(mails[0].to,'vip@primesportsante.fr');assert.equal(mails[0].from.address,'vip@primesportsante.fr');assert.match(mails[0].text,/2690.00/);assert.match(mails[0].text,/test@example.com/);assert.match(mails[0].text,/view=subscriptions/)
 assert.equal(await notify(adapter,id,actor,true,'internal'),'unchanged');assert.equal(mails.length,1)
 const r=await adapter.rpc('prime_pass_subscriptions',{p_actor:actor,p_action:'list',p_data:{}});assert.equal(r.data.subscriptions[0].notification_token,undefined);assert.equal(r.data.subscriptions[0].notification_status,'sent')
})
test('browser roles cannot access notification dispatch RPC',async()=>{await db.exec('reset role;set role authenticated');const r=await adapter.rpc('prime_pass_notification',{p_actor:actor,p_action:'claim',p_data:{id,retry:true}});assert.match(r.error.message,/permission denied/);await db.exec('reset role;set role service_role')})

test('internal notification and subscriber receipt have independent delivery and retry states',async()=>{
 const rid=randomUUID();await adapter.rpc('prime_pass_subscriptions',{p_actor:null,p_action:'submit',p_data:{id:rid,offer:'individual',contact_name:'Alice',email:'alice@example.com',phone:'0102030405',quantity:1,participants:[{first_name:'Alice',last_name:'Test',duo:true,duo_first_name:'Bob',duo_last_name:'Test'}],consent:true,ip_hash:'receipt'}})
 const mails=[];const notifier=createNotifier(async mail=>{mails.push(mail);if(mail.to==='alice@example.com')throw {code:'ECONNECTION'}},env)
 assert.equal(await notifier(adapter,rid),'failed');let s=(await db.query('select * from prime_pass.subscriptions where id=$1',[rid])).rows[0];assert.equal(s.notification_status,'sent');assert.equal(s.receipt_status,'failed');assert.equal(mails.length,2);assert.match(mails[1].text,/lien de paiement/);assert.match(mails[1].text,/Bob Test/);assert.match(mails[1].text,/2690.00/);assert.doesNotMatch(mails[1].text,/view=subscriptions/);assert.equal(mails[1].replyTo,'vip@primesportsante.fr');assert.match(mails[1].html,/cid:prime-logo@primesportsante.fr/);assert.equal(mails[1].attachments[0].contentType,'image/png');assert.notEqual(mails[0].messageId,mails[1].messageId)
 await db.query("update prime_pass.subscriptions set receipt_attempted_at=now()-interval '2 minutes' where id=$1",[rid])
 const retry=[];const recovered=createNotifier(async mail=>{retry.push(mail)},env);await assert.rejects(()=>recovered(adapter,rid,randomUUID(),true,'subscriber'),/réservée/)
 assert.equal(await recovered(adapter,rid,actor,true,'subscriber'),'sent');assert.equal(retry.length,1);assert.equal(retry[0].to,'alice@example.com');assert.equal(await recovered(adapter,rid,actor,true,'subscriber'),'unchanged')
 s=(await db.query('select * from prime_pass.subscriptions where id=$1',[rid])).rows[0];assert.equal(s.notification_attempts,1);assert.equal(s.receipt_status,'sent');assert.equal(s.receipt_attempts,2)
 const list=await adapter.rpc('prime_pass_subscriptions',{p_actor:actor,p_action:'list',p_data:{}});assert.equal(list.data.subscriptions.find(x=>x.id===rid).receipt_token,undefined)
})
test('already activated subscription receives a receipt without a new payment request',async()=>{
 const rid=randomUUID();await adapter.rpc('prime_pass_subscriptions',{p_actor:null,p_action:'submit',p_data:{id:rid,offer:'company',company_name:'Receipt',contact_name:'Contact',email:'receipt@example.com',phone:'0102030405',quantity:1,participants:[],consent:true,ip_hash:'activated'}})
 await db.query("update prime_pass.subscriptions set status='activated' where id=$1",[rid]);const mails=[],notifier=createNotifier(async mail=>{mails.push(mail)},env)
 assert.equal(await notifier(adapter,rid,undefined,false,'subscriber'),'sent');assert.match(mails[0].text,/déjà été validée/);assert.doesNotMatch(mails[0].text,/Un lien de paiement vous sera envoyé/)
})
