import { test } from 'node:test'
import assert from 'node:assert/strict'
import { companyTariff, vipTariff, salesSummary, discountedAmount } from '../src/lib/model.ts'
test('annual reference tariffs and both duo profiles',()=>{
 assert.equal(companyTariff(1),2690);assert.equal(companyTariff(2),4380);assert.equal(companyTariff(3),6070)
 assert.equal(vipTariff('individual',false),1890);assert.equal(vipTariff('individual',true),2690)
 assert.equal(vipTariff('director',false),1690);assert.equal(vipTariff('director',true),2490)
})
test('active people counts include each duo but exclude expired future and suspended sales',()=>{
 const base={starts_on:'2026-01-01',ends_on:'2026-12-31',active:true,paid_amount:2490,duo:true,profile:'director'}
 const s={today:'2026-10-28',companies:[{id:'a',active:true},{id:'b',active:false}],contracts:[{...base,company_id:'a',daily_rights:2,paid_amount:4300},{...base,company_id:'b',daily_rights:9},{...base,company_id:'a',starts_on:'2027-01-01',ends_on:'2027-12-31',daily_rights:3}],vips:[base,{...base,duo:false,profile:'individual',paid_amount:1800},{...base,ends_on:'2025-12-31'},{...base,active:false}]}
 s.contracts.push({...s.contracts[0],daily_rights:9,retired_at:'2026-10-01T00:00:00Z'});
 const t=salesSummary(s);assert.equal(t.total,5);assert.equal(t.duoCount,1);assert.equal(t.enterpriseAmount,4300);assert.equal(t.individualAmount,1800);assert.equal(t.directorAmount,2490)
 s.contracts[0].paid_amount=null;assert.equal(salesSummary(s).missingPrices,1);assert.equal(salesSummary(s).enterpriseAmount,0)
})

test('exclusive commercial conditions apply to base and duo in cents',()=>{assert.equal(discountedAmount(2690,'jl_group'),2152);assert.equal(discountedAmount(2490,'jl_group'),1992);assert.equal(discountedAmount(4380,'free'),0);assert.equal(discountedAmount(1890,'standard'),1890)})
