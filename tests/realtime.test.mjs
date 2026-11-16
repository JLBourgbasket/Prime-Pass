import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { randomUUID } from 'node:crypto'
test('live updates reveal only revisions belonging to authorized accounts',async()=>{
 const db=new PGlite()
 try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create publication supabase_realtime")
 await db.exec(await readFile(new URL('../supabase/prime_pass_v2.sql',import.meta.url),'utf8'))
 await db.exec(await readFile(new URL('../supabase/realtime.sql',import.meta.url),'utf8'))
 const a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID()
 await db.query('insert into auth.users values($1),($2)',[a,b])
 await db.query("insert into prime_pass.companies(id,name,contact_name,email,phone,request_id) values($1,'AGIR','Contact','a@example.com','0102',$1),($2,'Autre','Contact','b@example.com','0103',$2)",[c,d])
 await db.query("insert into prime_pass.accounts(user_id,role,company_id) values($1,'company',$2),($3,'company',$4)",[a,c,b,d])
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);await db.exec('set role authenticated')
 assert.equal((await db.query('select * from public.prime_pass_updates')).rows.length,1)
 assert.equal((await db.query('select * from public.prime_pass_updates')).rows[0].company_id,c)
 await assert.rejects(()=>db.query('select * from prime_pass.companies'),/permission denied/)
 await assert.rejects(()=>db.query('update public.prime_pass_updates set revision=99'),/permission denied/)
 await db.exec('reset role')
 const before=(await db.query('select revision from public.prime_pass_updates where company_id=$1',[c])).rows[0].revision
 await db.query("insert into prime_pass.beneficiaries(company_id,first_name,last_name) values($1,'Camille','Exemple')",[c])
 const after=(await db.query('select revision from public.prime_pass_updates where company_id=$1',[c])).rows[0].revision
 assert.equal(Number(after),Number(before)+1)
 await db.query('update prime_pass.accounts set active=false where user_id=$1',[a]);await db.exec('set role authenticated')
 assert.equal((await db.query('select * from public.prime_pass_updates')).rows.length,0)
 }finally{await db.close()}
})
