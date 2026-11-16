import {test} from 'node:test'
import assert from 'node:assert/strict'
import {brandedEmail} from '../supabase/functions/_shared/email-template.ts'
test('branded HTML embeds official PNG with CID and a modern fallback font stack',()=>{
 const e=brandedEmail('Bonjour Alice,\nOffre : VIP individuel\nMontant annuel demandé : 1890 € TTC\nMerci.',true)
 assert.match(e.html,/font-family:.*Segoe UI/);assert.match(e.html,/cid:prime-logo@primesportsante.fr/);assert.match(e.html,/Montant annuel demandé/);assert.match(e.html,/max-width:600px/)
 const logo=e.attachments[0];assert.equal(logo.encoding,'base64');assert.equal(logo.contentType,'image/png');assert.equal(logo.contentDisposition,'inline');assert.equal(Buffer.from(logo.content,'base64').subarray(1,4).toString(),'PNG')
})
test('customer content is escaped and only internal mail has an administration button',()=>{
 const text='Bonjour <img src=x onerror=alert(1)>,\nEntreprise : <script>bad</script>\nConsulter dans Administration → Souscriptions : javascript:bad'
 const client=brandedEmail(text,true,'https://example.com/?view=subscriptions');assert.doesNotMatch(client.html,/<script>|onerror=alert\(1\)>/);assert.match(client.html,/&lt;script&gt;/);assert.doesNotMatch(client.html,/Consulter la souscription|javascript:bad/)
 const prime=brandedEmail(text,false,'https://example.com/?view=subscriptions');assert.match(prime.html,/Consulter la souscription/)
 assert.doesNotMatch(brandedEmail(text,false,'javascript:bad').html,/href="javascript/)
})
