export type Account = { user_id: string; role: 'prime_admin' | 'company'; company_id: string | null }
export type Company = { id: string; name: string; contact_name: string; email: string; phone: string; logo: string | null; active: boolean }
export type Contract = { id: string; company_id: string; starts_on: string; ends_on: string; daily_rights: number; cryo_quota: number }
export type Beneficiary = { id: string; company_id: string; first_name: string; last_name: string; active: boolean }
export type Claim = { id: string; company_id: string; contract_id: string; beneficiary_id: string; access_date: string; cancelled_at: string | null; created_at: string }
export type Cryo = { id: string; company_id: string; contract_id: string; beneficiary_id: string; performed_on: string; created_at: string; voided_at: string | null; void_reason: string | null }
export type Audit = { id: number; company_id: string; action: string; created_at: string; detail: { input?: { reason?: string } } }
export type Snapshot = { account: Account; today: string; companies: Company[]; contracts: Contract[]; beneficiaries: Beneficiary[]; claims: Claim[]; cryo: Cryo[]; audit: Audit[] }
export const fullName = (p?: Beneficiary) => p ? `${p.first_name} ${p.last_name}` : 'Bénéficiaire archivé'
export const parisToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const addDays = (day: string, count: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10) }
export const dateLabel = (day: string, long = false) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'long' as const, year: 'numeric' as const } : {}) }).format(new Date(`${day.slice(0, 10)}T12:00:00Z`))
export const contractAt = (s: Snapshot, company: string, day: string) => s.contracts.find(c => c.company_id === company && c.starts_on <= day && c.ends_on >= day)
export const available = (s: Snapshot, company: string, day: string) => {
  const contract = contractAt(s, company, day)
  return contract ? Math.max(0, contract.daily_rights - s.claims.filter(c => c.contract_id === contract.id && c.access_date === day && !c.cancelled_at).length) : 0
}
export const cryoUsed = (s: Snapshot, contract?: Contract) => contract ? s.cryo.filter(c => c.contract_id === contract.id && !c.voided_at).length : 0
