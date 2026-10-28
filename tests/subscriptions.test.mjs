import { before,after,test } from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {createSubscriptionHandler} from '../supabase/functions/_shared/subscription-handler.ts'
const db=new PGlite(),admin=randomUUID(),companyUser=randomUUID()
const rpc=async(actor,action,data={})=>(await db.query('select public.prime_pass_subscriptions($1,$2,$3) r',[actor,action,JSON.stringify(data)])).rows[0].r
const person={first_name:'Alice',last_name:'Test',duo:true,duo_first_name:'Bob',duo_last_name:'Test'}
const proposal=(patch={})=>({id:randomUUID(),offer:'individual',company_name:'',contact_name:'Alice Test',email:'alice@example.com',phone:'0102030405',quantity:1,participants:[person],consent:true,website:'',ip_hash:randomUUID(),...patch})
before(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)')
 for(const f of ['prime_pass_v2.sql','vip_sales.sql','subscriptions.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'))
 await db.query('insert into auth.users values($1),($2)',[admin,companyUser]);await db.query("insert into prime_pass.accounts(user_id,role) values($1,'prime_admin')",[admin]);await db.exec('set role service_role')
})
after(()=>db.close())
test('public submission computes prices, deduplicates retries, and never creates active VIPs',async()=>{
 const data=proposal({total_amount:1,status:'activated',paid_amount:1});const r=await rpc(null,'submit',data)
 assert.equal(r.total_amount,2690);assert.equal(r.tax_basis,'TTC');await rpc(null,'submit',data)
 const list=await rpc(admin,'list');assert.equal(list.subscriptions.length,1);assert.equal(list.subscriptions[0].status,'pending');assert.equal(list.subscriptions[0].ip_hash,undefined)
 assert.equal((await db.query('select count(*)::int n from prime_pass.vips')).rows[0].n,0)
 await assert.rejects(()=>rpc(null,'list'),/réservée/);await assert.rejects(()=>rpc(companyUser,'activate',{id:data.id}),/réservée/)
})
test('company and director rates, quantities, consent and duo names are enforced',async()=>{
 const c=await rpc(null,'submit',proposal({offer:'company',company_name:'AGIR',quantity:3,participants:[],email:'company@example.com'}));assert.equal(c.total_amount,6070);assert.equal(c.tax_basis,'HT')
 const d=await rpc(null,'submit',proposal({offer:'director',quantity:2,participants:[person,{...person,duo:false}],email:'director@example.com'}));assert.equal(d.total_amount,4180)
 for(const patch of [{consent:false},{website:'bot'},{quantity:2},{participants:[{...person,duo_first_name:''}]},{quantity:0},{quantity:151},{offer:'invalid'},{email:'invalid'}]) await assert.rejects(()=>rpc(null,'submit',proposal(patch)))
})
test('activation creates VIPs once, keeps financial total exact, and closing campaign blocks intake',async()=>{
 const id=randomUUID();await rpc(null,'submit',proposal({id,email:'activate@example.com',quantity:2,participants:[person,{...person,duo:false}]}))
 await rpc(admin,'activate',{id,starts_on:'2026-01-01',ends_on:'2026-12-31',paid_amount:'4000.01'})
 await rpc(admin,'activate',{id,starts_on:'2026-01-01',ends_on:'2026-12-31',paid_amount:'4000.01'})
 const result=await db.query('select count(*)::int n,sum(paid_amount)::text amount from prime_pass.vips');assert.equal(result.rows[0].n,2);assert.equal(result.rows[0].amount,'4000.01')
 await rpc(admin,'set_campaign',{enabled:false});assert.equal((await rpc(null,'campaign')).enabled,false);await assert.rejects(()=>rpc(null,'submit',proposal()),/fermée/);await rpc(admin,'set_campaign',{enabled:true})
})
test('enterprise activation creates a shared account/contract; intake and activation are separate',async()=>{
 const id=randomUUID();await rpc(null,'submit',proposal({id,offer:'company',company_name:'Test entreprise',quantity:2,participants:[],email:'enterprise@example.com'}))
 await rpc(admin,'activate',{id,auth_user_id:companyUser,starts_on:'2026-01-01',ends_on:'2026-12-31',paid_amount:4380})
 const ct=(await db.query('select daily_rights,paid_amount::text from prime_pass.contracts')).rows[0];assert.equal(ct.daily_rights,2);assert.equal(ct.paid_amount,'4380.00')
 await assert.rejects(()=>rpc(companyUser,'list'),/réservée/)
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc(null,'campaign'),/permission denied/);await assert.rejects(()=>db.query('select * from prime_pass.subscriptions'),/permission denied/);await db.exec('reset role;set role service_role')
})
test('rate limits constrain repeated public intake',async()=>{
 for(let i=0;i<5;i++)await rpc(null,'submit',proposal({email:'limited@example.com'}))
 await assert.rejects(()=>rpc(null,'submit',proposal({email:'limited@example.com'})),/Trop de demandes/)
})
test('public Edge permits intake only and never honors supplied actor/action/ip',async()=>{
 const calls=[];const handle=createSubscriptionHandler(()=>({rpc:async(name,args)=>{calls.push(args);return{data:{ok:true}}}}),k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"secret"}'}[k]))
 const req=(body)=>new Request('https://test.supabase.co',{method:'POST',headers:{Origin:'https://deploy-preview-1--primepassentreprise.netlify.app','content-type':'application/json'},body:JSON.stringify(body)})
 assert.equal((await handle(req({action:'activate',p_actor:'attacker',ip_hash:'forged'}))).status,200);assert.equal(calls[0].p_actor,null);assert.equal(calls[0].p_action,'submit');assert.notEqual(calls[0].p_data.ip_hash,'forged')
 assert.equal((await handle(new Request('https://test.supabase.co',{headers:{Origin:'https://evil.test'}}))).status,403)
 assert.equal((await handle(req({text:'a'.repeat(33000)}))).status,413)
})
