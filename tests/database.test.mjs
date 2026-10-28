import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), admin=randomUUID(), account=randomUUID(), other=randomUUID(), company=randomUUID(), company2=randomUUID()
let today, contract, people=[]
const rpc = async (actor,action,data={}) => (await db.query('select public.prime_pass_execute($1,$2,$3) as result',[actor,action,JSON.stringify(data)])).rows[0].result
before(async()=>{
 await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key)')
 await db.exec(await readFile(new URL('../supabase/prime_pass_v2.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/vip_sales.sql',import.meta.url),'utf8'))
 await db.query('insert into auth.users(id) values ($1),($2),($3)',[admin,account,other])
 await db.query("insert into prime_pass.accounts(user_id,role) values($1,'prime_admin')",[admin])
 today=(await db.query("select (now() at time zone 'Europe/Paris')::date::text d")).rows[0].d
 await db.exec('set role service_role')
 for (const [cid,user,name] of [[company,account,'AGIR'],[company2,other,'Autre entreprise']]) {
  const c=await rpc(admin,'create_company',{name,contact_name:'Contact',email:`${name.replaceAll(' ','')}@example.com`,phone:'0102030405',request_id:cid,auth_user_id:user,starts_on:today,ends_on:'2030-12-31',daily_rights:1})
  if(cid===company) { globalThis.actualCompany=c.id }
 }
 const snap=await rpc(account,'snapshot'); contract=snap.contracts[0];
 for(const name of ['Alice','Bob','Camille']) await rpc(account,'add_beneficiary',{company_id:contract.company_id,first_name:name,last_name:'Test'})
 people=(await rpc(account,'snapshot')).beneficiaries
})
after(()=>db.close())
test('company snapshots exclude other companies and audit details',async()=>{const s=await rpc(account,'snapshot');assert.equal(s.companies.length,1);assert.equal(s.beneficiaries.length,3);assert.deepEqual(s.audit,[]);assert.equal(s.contracts[0].cryo_quota,20)})
test('browser roles cannot call backend RPC or read private tables',async()=>{await db.exec('reset role;set role authenticated');await assert.rejects(()=>rpc(admin,'snapshot'),/permission denied/);await assert.rejects(()=>db.query('select * from prime_pass.companies'),/permission denied/);await db.exec('reset role;set role anon');await assert.rejects(()=>rpc(admin,'snapshot'),/permission denied/);await db.exec('reset role;set role service_role')})
test('unknown accounts, cross-company operations and company cryo writes are denied',async()=>{
 await assert.rejects(()=>rpc(randomUUID(),'snapshot'),/Compte non autorisé/)
 await assert.rejects(()=>rpc(other,'add_beneficiary',{company_id:contract.company_id,first_name:'X',last_name:'Y'}),/non autorisée/)
 await assert.rejects(()=>rpc(account,'record_cryo',{company_id:contract.company_id}),/réservée à Prime/)
})
test('last daily right, duplicate clicks and replay protection',async()=>{
 const data={company_id:contract.company_id,beneficiary_id:people[0].id,access_date:today,request_id:randomUUID()}
 await rpc(account,'claim',data);await rpc(account,'claim',data)
 await assert.rejects(()=>rpc(account,'claim',{...data,request_id:randomUUID()}),/déjà/)
 await assert.rejects(()=>rpc(account,'claim',{...data,beneficiary_id:people[1].id,request_id:randomUUID()}),/Tous les droits/)
 const s=await rpc(account,'snapshot');assert.equal(s.claims.filter(c=>!c.cancelled_at).length,1)
})
test('same-day and repeated cancellation restore capacity without erasing history',async()=>{
 const s=await rpc(account,'snapshot'), claim=s.claims[0]
 await rpc(account,'cancel_claim',{company_id:contract.company_id,id:claim.id});await rpc(account,'cancel_claim',{company_id:contract.company_id,id:claim.id})
 await rpc(account,'claim',{company_id:contract.company_id,beneficiary_id:people[1].id,access_date:today,request_id:randomUUID()})
 const next=await rpc(account,'snapshot');assert.equal(next.claims.length,2);assert.equal(next.claims.filter(c=>!c.cancelled_at).length,1)
})
test('deactivation releases allocated rights while keeping names and history',async()=>{
 await rpc(account,'update_beneficiary',{company_id:contract.company_id,id:people[1].id,first_name:'Bob',last_name:'Test',active:false})
 const s=await rpc(account,'snapshot');assert.equal(s.claims.filter(c=>!c.cancelled_at).length,0)
 await assert.rejects(()=>rpc(account,'claim',{company_id:contract.company_id,beneficiary_id:people[1].id,access_date:today,request_id:randomUUID()}),/inactif/)
})
test('future window and beneficiary company are enforced in the database',async()=>{
 for (const day of ['2020-01-01','2030-01-01']) await assert.rejects(()=>rpc(account,'claim',{company_id:contract.company_id,beneficiary_id:people[0].id,access_date:day,request_id:randomUUID()}),/14 prochains/)
 await assert.rejects(()=>rpc(other,'cancel_claim',{company_id:contract.company_id,id:randomUUID()}),/non autorisée/)
})
test('cryo quota, retries and auditable correction share one balance',async()=>{
 const data={company_id:contract.company_id,beneficiary_id:people[0].id,performed_on:today,request_id:randomUUID()}
 await rpc(admin,'record_cryo',data);await rpc(admin,'record_cryo',data)
 assert.equal((await rpc(account,'snapshot')).cryo.length,1)
 for(let i=1;i<20;i++) await rpc(admin,'record_cryo',{...data,request_id:randomUUID()})
 await assert.rejects(()=>rpc(admin,'record_cryo',{...data,request_id:randomUUID()}),/épuisé/)
 const s=await rpc(account,'snapshot'), c=s.cryo[0]
 await assert.rejects(()=>rpc(admin,'void_cryo',{company_id:contract.company_id,id:c.id,reason:''}),/check constraint/)
 await assert.rejects(()=>rpc(admin,'void_cryo',{company_id:contract.company_id,id:c.id,reason:null}),/check constraint/)
 await rpc(admin,'void_cryo',{company_id:contract.company_id,id:c.id,reason:'Erreur de saisie'})
 await rpc(admin,'void_cryo',{company_id:contract.company_id,id:c.id,reason:'Deuxième clic'})
 await rpc(admin,'record_cryo',{...data,request_id:randomUUID()})
 const next=await rpc(account,'snapshot');assert.equal(next.cryo.filter(c=>!c.voided_at).length,20);assert.equal(next.cryo.filter(c=>c.voided_at).length,1)
 assert.equal((await rpc(admin,'snapshot')).audit.filter(a=>a.action==='void_cryo').length,1)
})
test('renewal separates quotas and prevents overlapping contracts',async()=>{
 await assert.rejects(()=>rpc(admin,'add_contract',{company_id:contract.company_id,starts_on:today,ends_on:'2031-01-01',daily_rights:2}),/chevaucher/)
 await rpc(admin,'add_contract',{company_id:contract.company_id,starts_on:'2031-01-01',ends_on:'2031-12-31',daily_rights:2})
 const s=await rpc(account,'snapshot');assert.equal(s.contracts.length,2);assert.equal(s.contracts[1].cryo_quota,40);assert.equal(s.cryo.filter(c=>c.contract_id===s.contracts[1].id).length,0)
})

test('VIP records are admin-only, validate duo identities, and preserve paid amounts',async()=>{
 const vip={id:randomUUID(),first_name:'VIP',last_name:'Test',email:'vip@example.com',phone:'',profile:'individual',duo:true,duo_first_name:'Duo',duo_last_name:'Test',starts_on:today,ends_on:'2030-12-31',paid_amount:'2690.50',active:true}
 await assert.rejects(()=>rpc(account,'save_vip',vip),/réservée à Prime/)
 await rpc(admin,'save_vip',vip); await rpc(admin,'save_vip',vip)
 assert.equal((await rpc(admin,'snapshot')).vips.length,1)
 assert.equal(Number((await rpc(admin,'snapshot')).vips[0].paid_amount),2690.50)
 assert.deepEqual((await rpc(account,'snapshot')).vips,[])
 await assert.rejects(()=>rpc(admin,'save_vip',{...vip,id:randomUUID(),duo_first_name:''}),/check constraint/)
 await assert.rejects(()=>rpc(admin,'save_vip',{...vip,paid_amount:'-1'}),/check constraint/)
 await assert.rejects(()=>rpc(admin,'save_vip',{...vip,ends_on:'2020-01-01'}),/check constraint/)
 await rpc(admin,'save_vip',{...vip,active:false})
 assert.equal((await rpc(admin,'snapshot')).vips[0].active,false)
 assert.equal((await rpc(admin,'snapshot')).audit.filter(x=>x.action==='save_vip').length,2)
})
test('contract paid amounts can be corrected and historical unknown prices stay null',async()=>{
 const ct=(await rpc(admin,'snapshot')).contracts.find(c=>c.id===contract.id)
 assert.equal(ct.paid_amount,null)
 await rpc(admin,'update_contract',{...ct,paid_amount:'2400.25'})
 assert.equal(Number((await rpc(admin,'snapshot')).contracts.find(c=>c.id===ct.id).paid_amount),2400.25)
 await assert.rejects(()=>rpc(account,'update_contract',{...ct,paid_amount:'10'}),/réservée à Prime/)
 await assert.rejects(()=>rpc(admin,'update_contract',{...ct,paid_amount:'-1'}),/check constraint/)
})
