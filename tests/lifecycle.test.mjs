import {before,after,test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),admin=randomUUID(),user=randomUUID();let company,person,oldContract,vip=randomUUID(),today
const rpc=async(name,actor,action,data={})=>(await db.query(`select public.${name}($1,$2,$3) r`,[actor,action,JSON.stringify(data)])).rows[0].r
const main=(a,d,actor=admin)=>rpc('prime_pass_execute',actor,a,d),life=(a,d,actor=admin)=>rpc('prime_pass_lifecycle',actor,a,d)
before(async()=>{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key)')
 for(const f of ['prime_pass_v2.sql','vip_sales.sql','subscriptions.sql','admin_discounts.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'))
 await db.exec('create table public.prime_pass_updates(company_id uuid primary key references prime_pass.companies(id),revision bigint default 1);grant all on public.prime_pass_updates to service_role')
 await db.exec(await readFile(new URL('../supabase/client_lifecycle.sql',import.meta.url),'utf8'))
 await db.query('insert into auth.users values($1),($2)',[admin,user]);await db.query("insert into prime_pass.accounts(user_id,role) values($1,'prime_admin')",[admin]);await db.exec('set role service_role')
 today=(await db.query("select (now() at time zone 'Europe/Paris')::date::text d")).rows[0].d
 company=(await main('create_company',{name:'Life Test',contact_name:'Contact',email:'life@example.com',phone:'0102030405',auth_user_id:user,request_id:randomUUID(),starts_on:today,ends_on:'2030-12-31',daily_rights:1,paid_amount:2690})).id
 await main('add_beneficiary',{company_id:company,first_name:'Alice',last_name:'Test'},user);const s=await main('snapshot',{},user);person=s.beneficiaries[0].id;oldContract=s.contracts[0].id
 await main('claim',{company_id:company,beneficiary_id:person,access_date:today,request_id:randomUUID()},user)
 await main('record_cryo',{company_id:company,beneficiary_id:person,performed_on:today,request_id:randomUUID()})
 await main('save_vip',{id:vip,first_name:'VIP',last_name:'Life',profile:'individual',duo:false,starts_on:today,ends_on:'2030-12-31',paid_amount:1890,active:true})
})
after(()=>db.close())
test('archive confirms server ownership, blocks access, releases rights and retains history',async()=>{
 await assert.rejects(()=>life('archive_company',{id:company},user),/réservée/)
 await assert.rejects(()=>life('purge_company',{id:company,confirmation:'Life Test'}),/Désactivez/)
 await life('archive_company',{id:company});await assert.rejects(()=>main('snapshot',{},user),/non autorisé/)
 const s=await main('snapshot');assert.equal(s.companies[0].active,false);assert.ok(s.contracts[0].retired_at);assert.ok(s.claims[0].cancelled_at);assert.equal(s.cryo.length,1);assert.equal(s.beneficiaries.length,1)
 await assert.rejects(()=>main('update_company',{company_id:company,name:'Life Test',contact_name:'Contact',phone:'0102030405',active:true}),/Clients désactivés/)
})
test('restore creates a fresh contract/quota without overlapping old rights or losing history',async()=>{
 await assert.rejects(()=>life('restore_company',{id:company}),/null value/)
 await life('restore_company',{id:company,starts_on:today,ends_on:'2031-12-31',daily_rights:3,paid_amount:4856,discount:'jl_group'})
 const s=await main('snapshot',{},user);assert.equal(s.companies[0].active,true);assert.equal(s.contracts.length,2);const ct=s.contracts.find(c=>!c.retired_at);assert.equal(ct.daily_rights,3);assert.equal(ct.cryo_quota,60);assert.equal(s.cryo.filter(c=>c.contract_id===ct.id).length,0);assert.equal(s.cryo[0].contract_id,oldContract)
 await main('claim',{company_id:company,beneficiary_id:person,access_date:today,request_id:randomUUID()},user)
 await assert.rejects(()=>life('restore_company',{id:company,starts_on:today,ends_on:'2031-12-31',daily_rights:3,paid_amount:6070}),/déjà active/)
})
test('VIP archival and new conditions are separate from ordinary editing',async()=>{
 await life('archive_vip',{id:vip});const v=(await main('snapshot')).vips[0];assert.equal(v.active,false)
 await assert.rejects(()=>main('save_vip',{...v,active:true}),/Clients désactivés/)
 await life('restore_vip',{id:vip,starts_on:today,ends_on:'2031-12-31',profile:'director',duo:true,duo_first_name:'Duo',duo_last_name:'Test',paid_amount:0,discount:'free'})
 const next=(await main('snapshot')).vips[0];assert.equal(next.active,true);assert.equal(next.profile,'director');assert.equal(Number(next.amount_due),0)
 await assert.rejects(()=>life('purge_vip',{id:vip,confirmation:'VIP Life'}),/Désactivez/)
 await life('archive_vip',{id:vip});await assert.rejects(()=>life('purge_vip',{id:vip,confirmation:'wrong'}),/nom exact/)
 await life('purge_vip',{id:vip,confirmation:'VIP Life'});assert.equal((await main('snapshot')).vips.length,0)
})
test('permanent company deletion removes dependencies and queues Auth cleanup; browser roles cannot purge',async()=>{
 await life('archive_company',{id:company});await assert.rejects(()=>life('purge_company',{id:company,confirmation:'wrong'}),/nom exact/)
 await db.exec('reset role;set role authenticated');await assert.rejects(()=>life('purge_company',{id:company,confirmation:'Life Test'}),/permission denied/);await db.exec('reset role;set role service_role')
 const r=await life('purge_company',{id:company,confirmation:'Life Test'});assert.deepEqual(r.auth_users,[user]);const s=await main('snapshot');assert.equal(s.companies.length,0);assert.equal(s.contracts.length,0);assert.equal(s.beneficiaries.length,0);assert.equal(s.claims.length,0);assert.equal(s.cryo.length,0);assert.deepEqual(await life('cleanup_list'),[user]);await life('cleanup_done',{user_id:user});assert.deepEqual(await life('cleanup_list'),[])
})
test('permanent VIP deletion redacts its identity in a shared request while preserving the other VIP',async()=>{
 const request=randomUUID();const participants=[{first_name:'Alice',last_name:'Shared',duo:false},{first_name:'Claire',last_name:'Shared',duo:false}]
 await rpc('prime_pass_subscriptions',null,'submit',{id:request,offer:'individual',contact_name:'Contact',email:'shared@example.com',phone:'0102030405',quantity:2,participants,consent:true,ip_hash:'shared'})
 await rpc('prime_pass_subscriptions',admin,'activate',{id:request,starts_on:today,ends_on:'2030-12-31',paid_amount:3780})
 const v=(await main('snapshot')).vips.find(v=>v.first_name==='Alice');await life('archive_vip',{id:v.id});await life('purge_vip',{id:v.id,confirmation:'Alice Shared'})
 const s=await main('snapshot');assert.equal(s.vips.length,1);assert.equal(s.vips[0].first_name,'Claire')
 const sub=(await rpc('prime_pass_subscriptions',admin,'get',{id:request}));assert.equal(sub.participants[0].first_name,'Client');assert.equal(sub.participants[1].first_name,'Claire');assert.equal(sub.linked_records[0].deleted,true)
})
