import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandler } from '../supabase/functions/_shared/handler.ts'
const origin='https://primepassentreprise.netlify.app'
const env=k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"test-backend-secret"}'}[k])
const request=(body,token='valid',headers={})=>new Request('https://test.supabase.co/functions/v1/prime-pass',{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
function setup(role='company'){
 const calls=[]
 const factory=()=>({
   auth:{getUser:async token=>token==='valid'?{data:{user:{id:'verified-user'}}}:{data:{user:null},error:{message:'invalid'}}},
   rpc:async(name,args)=>{
     calls.push(args)
     return {data:args.p_action==='snapshot'?{account:{role},companies:[]}:{ok:true}}
   }
 })
 return {handle:createHandler(factory,env),calls}
}
test('missing or invalid sessions are rejected before any database call',async()=>{
 const {handle,calls}=setup();const noAuth=new Request('https://test.supabase.co',{method:'POST',body:'{}'})
 assert.equal((await handle(noAuth)).status,401);assert.equal((await handle(request({action:'snapshot'},'forged'))).status,401);assert.equal(calls.length,0)
})
test('verified actor overrides caller supplied identity',async()=>{
 const {handle,calls}=setup();assert.equal((await handle(request({action:'claim',p_actor:'attacker',data:{p_actor:'attacker'}}))).status,200)
 assert.equal(calls[0].p_actor,'verified-user')
})
test('company accounts cannot provision enterprise logins or send access links',async()=>{
 for(const action of ['create_company','send_access_link']){const {handle}=setup();assert.equal((await handle(request({action}))).status,403)}
})
test('only configured browser origin is accepted, including preflight',async()=>{
 const {handle}=setup();assert.equal((await handle(request({action:'snapshot'},'valid',{Origin:'https://untrusted.example'}))).status,403)
 const r=await handle(new Request('https://test.supabase.co',{method:'OPTIONS',headers:{Origin:origin}}));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),origin)
})
test('invalid actions, oversized bodies and malformed JSON are rejected',async()=>{
 const {handle}=setup();assert.equal((await handle(request({action:'drop_database'}))).status,400)
 assert.equal((await handle(request({action:'snapshot'},'valid',{'Content-Length':'600000'}))).status,413)
 assert.equal((await handle(new Request('https://test.supabase.co',{method:'POST',headers:{Authorization:'Bearer valid'},body:'not-json'}))).status,400)
})
test('database errors produce actionable safe errors',async()=>{
 const handle=createHandler(()=>({auth:{getUser:async()=>({data:{user:{id:'verified'}}})},rpc:async()=>({error:{message:'new row violates check constraint secret_detail'}})}),env)
 const r=await handle(request({action:'claim'}));assert.equal(r.status,400);assert.equal((await r.json()).error,'Vérifiez les champs saisis et les valeurs du contrat.')
})
