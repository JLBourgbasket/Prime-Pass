import { addDays, parisToday, contractAt, available, cryoUsed } from './model'
import type { Snapshot } from './model'
const key = 'prime-pass-explicit-demo-v2'
export const demoEnabled = import.meta.env.VITE_ENABLE_DEMO === 'true' && new URLSearchParams(location.search).has('demo')
const id = () => crypto.randomUUID()
export function demoSnapshot(): Snapshot {
  const day = parisToday()
  const existing = localStorage.getItem(key)
  if (existing) { try { return { ...JSON.parse(existing), today: day } } catch { /* reset invalid demo data */ } }
  const s: Snapshot = {
    today: day, account: { user_id: 'demo', role: 'company', company_id: 'agir' },
    companies: [{ id: 'agir', name: 'AGIR', contact_name: 'Contact AGIR', email: 'contact@example.com', phone: 'À renseigner', logo: '/agir.png', active: true }],
    contracts: [{ id: 'contract-agir', company_id: 'agir', starts_on: `${day.slice(0, 4)}-01-01`, ends_on: `${Number(day.slice(0, 4)) + 1}-12-31`, daily_rights: 2, cryo_quota: 40, paid_amount: 4380 }],
    beneficiaries: [{ id: 'p1', company_id: 'agir', first_name: 'Alex', last_name: 'Martin', active: true }, { id: 'p2', company_id: 'agir', first_name: 'Claire', last_name: 'Martin', active: true }],
    claims: [{ id: id(), company_id: 'agir', beneficiary_id: 'p1', contract_id: 'contract-agir', access_date: day, created_at: new Date().toISOString(), cancelled_at: null }, { id: id(), company_id: 'agir', beneficiary_id: 'p2', contract_id: 'contract-agir', access_date: addDays(day, 2), created_at: new Date().toISOString(), cancelled_at: null }], cryo: [], audit: [],
  }
  localStorage.setItem(key, JSON.stringify(s)); return s
}
export async function demoApi(action: string, data: Record<string, unknown> = {}) {
  const s = demoSnapshot(), now = new Date().toISOString(), company = String(data.company_id), prime = s.account.role === 'prime_admin'
  if (action === 'snapshot') return s
  if (action === 'save_vip' && prime) { s.vips ||= []; const v = { ...data, paid_amount: Number(data.paid_amount) } as unknown as import('./model').Vip; const i = s.vips.findIndex(x => x.id === v.id); if (i >= 0) s.vips[i] = v; else s.vips.push(v) }
  else if (action === 'demo_role') { s.account.role = data.role === 'prime_admin' ? 'prime_admin' : 'company' }
  else if (!prime && company !== s.account.company_id) throw new Error('Entreprise non autorisée')
  else if (action === 'claim') {
    const day = String(data.access_date), person = s.beneficiaries.find(p => p.id === data.beneficiary_id && p.company_id === company && p.active)
    if (!person) throw new Error('Bénéficiaire inactif')
    if (day < s.today || day > addDays(s.today, 14)) throw new Error('Date hors planning')
    if (s.claims.some(c => c.beneficiary_id === person.id && c.access_date === day && !c.cancelled_at)) throw new Error('Ce bénéficiaire dispose déjà d’un droit à cette date')
    if (available(s, company, day) < 1) throw new Error('Tous les droits sont attribués pour cette date')
    s.claims.unshift({ id: id(), company_id: company, contract_id: contractAt(s, company, day)!.id, beneficiary_id: person.id, access_date: day, created_at: now, cancelled_at: null })
  } else if (action === 'cancel_claim') {
    const c = s.claims.find(c => c.id === data.id && c.company_id === company); if (!c) throw new Error('Droit introuvable'); c.cancelled_at ||= now
  } else if (action === 'add_beneficiary') {
    s.beneficiaries.push({ id: id(), company_id: company, first_name: String(data.first_name), last_name: String(data.last_name), active: true })
  } else if (action === 'update_beneficiary') {
    const p = s.beneficiaries.find(p => p.id === data.id && p.company_id === company); if (!p) throw new Error('Bénéficiaire introuvable')
    Object.assign(p, { first_name: data.first_name, last_name: data.last_name, active: data.active })
    if (!p.active) s.claims.forEach(c => { if (c.beneficiary_id === p.id && !c.cancelled_at && c.access_date >= s.today) c.cancelled_at = now })
  } else if (!prime) throw new Error('Action réservée à Prime')
  else if (action === 'record_cryo') {
    const day = String(data.performed_on), c = contractAt(s, company, day)
    if (!c || day > s.today) throw new Error('Date de séance invalide')
    if (cryoUsed(s, c) >= c.cryo_quota) throw new Error('Quota cryo épuisé')
    s.cryo.unshift({ id: id(), company_id: company, contract_id: c.id, beneficiary_id: String(data.beneficiary_id), performed_on: day, created_at: now, voided_at: null, void_reason: null })
  } else if (action === 'void_cryo') {
    const c = s.cryo.find(c => c.id === data.id && c.company_id === company); if (!c || !String(data.reason || '').trim()) throw new Error('Motif requis'); c.voided_at ||= now; c.void_reason = String(data.reason)
  } else if (action === 'create_company') {
    const cid = id(), rights = Number(data.daily_rights)
    s.companies.push({ id: cid, name: String(data.name), contact_name: String(data.contact_name), email: String(data.email), phone: String(data.phone), logo: String(data.logo || '') || null, active: true })
    s.contracts.push({ id: id(), company_id: cid, starts_on: String(data.starts_on), ends_on: String(data.ends_on), daily_rights: rights, cryo_quota: rights * 20, paid_amount: data.paid_amount == null ? null : Number(data.paid_amount) })
  } else if (action === 'update_company') {
    const c = s.companies.find(c => c.id === company); if (c) Object.assign(c, data)
  } else if (action === 'add_contract' || action === 'update_contract') {
    const start = String(data.starts_on), end = String(data.ends_on), rights = Number(data.daily_rights)
    if (start > end || rights < 1) throw new Error('Contrat invalide')
    if (s.contracts.some(c => c.company_id === company && c.id !== data.id && c.starts_on <= end && c.ends_on >= start)) throw new Error('Les contrats ne peuvent pas se chevaucher')
    const c = { id: String(data.id || id()), company_id: company, starts_on: start, ends_on: end, daily_rights: rights, cryo_quota: rights * 20, paid_amount: data.paid_amount == null ? null : Number(data.paid_amount) }
    if (action === 'add_contract') s.contracts.push(c); else { const i = s.contracts.findIndex(x => x.id === data.id); if (i >= 0) s.contracts[i] = c }
  } else if (action !== 'send_access_link') throw new Error('Action inconnue')
  if (action !== 'demo_role') s.audit.unshift({ id: s.audit.length + 1, company_id: company, action, created_at: now, detail: { input: { reason: String(data.reason || '') } } })
  localStorage.setItem(key, JSON.stringify(s)); window.dispatchEvent(new Event('prime-demo-change'))
  return { ok: true, notice: action === 'create_company' ? 'Entreprise ajoutée en démonstration. Aucun e-mail envoyé.' : undefined }
}
