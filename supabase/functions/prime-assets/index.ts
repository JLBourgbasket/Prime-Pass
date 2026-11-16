import { primeLogo } from '../_shared/email-logo.ts'
const bytes=Uint8Array.from(atob(primeLogo),c=>c.charCodeAt(0))
Deno.serve((request:Request)=>{
 const headers={'Content-Type':'image/png','Cache-Control':'public, max-age=86400','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="prime-sport-sante.png"'}
 if(!new URL(request.url).pathname.endsWith('/prime-logo.png'))return new Response('Not found',{status:404})
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}})
 return new Response(request.method==='HEAD'?null:bytes,{headers})
})
