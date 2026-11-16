export type Account = { user_id: string; role: 'prime_admin' | 'company'; company_id: string | null }
export type Company = { id: string; name: string; contact_name: string; email: string; phone: string; logo: string | null; active: boolean }
export type Pricing = { discount?: Discount; list_amount?: number; amount_due?: number; paid_amount?: number | null }
export type Discount = 'standard' | 'jl_group' | 'free'
export type Contract = Pricing & { id: string; company_id: string; starts_on: string; ends_on: string; daily_rights: number; cryo_quota: number; retired_at?: string | null; paid_amount?: number | null }
export type Beneficiary = { id: string; company_id: string; first_name: string; last_name: string; active: boolean }
export type Claim = { id: string; company_id: string; contract_id: string; beneficiary_id: string; access_date: string; cancelled_at: string | null; created_at: string }
export type Cryo = { id: string; company_id: string; contract_id: string; beneficiary_id: string; performed_on: string; created_at: string; voided_at: string | null; void_reason: string | null }
export type Audit = { id: number; company_id: string; action: string; created_at: string; detail: { input?: { reason?: string } } }
export type Snapshot = { account: Account; today: string; companies: Company[]; contracts: Contract[]; beneficiaries: Beneficiary[]; claims: Claim[]; cryo: Cryo[]; audit: Audit[]; vips?: Vip[] }
export const fullName = (p?: Beneficiary) => p ? `${p.first_name} ${p.last_name}` : 'Bénéficiaire archivé'
export const parisToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const addDays = (day: string, count: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10) }
export const dateLabel = (day: string, long = false) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { weekday: 'long' as const, year: 'numeric' as const } : {}) }).format(new Date(`${day.slice(0, 10)}T12:00:00Z`))
export const contractAt = (s: Snapshot, company: string, day: string) => s.contracts.find(c => !c.retired_at && c.company_id === company && c.starts_on <= day && c.ends_on >= day)
export const available = (s: Snapshot, company: string, day: string) => {
  const contract = contractAt(s, company, day)
  return contract ? Math.max(0, contract.daily_rights - s.claims.filter(c => c.contract_id === contract.id && c.access_date === day && !c.cancelled_at).length) : 0
}
export const cryoUsed = (s: Snapshot, contract?: Contract) => contract ? s.cryo.filter(c => c.contract_id === contract.id && !c.voided_at).length : 0

export type Vip = Pricing & { id: string; first_name: string; last_name: string; email: string; phone: string; profile: 'individual' | 'director'; duo: boolean; duo_first_name: string | null; duo_last_name: string | null; starts_on: string; ends_on: string; paid_amount: number; active: boolean }
export const companyTariff = (rights: number) => 2690 + Math.max(0, rights - 1) * 1690
export const vipTariff = (profile: string, duo: boolean) => (profile === 'director' ? 1690 : 1890) + (duo ? 800 : 0)
export const euros = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount)
export function salesSummary(s: Snapshot) {
  const contracts = s.contracts.filter(c => !c.retired_at && s.companies.some(co => co.id === c.company_id && co.active) && c.starts_on <= s.today && c.ends_on >= s.today)
  const vips = (s.vips || []).filter(v => v.active && v.starts_on <= s.today && v.ends_on >= s.today)
  const individual = vips.filter(v => v.profile === 'individual'), directors = vips.filter(v => v.profile === 'director')
  const enterpriseCount = contracts.reduce((n, c) => n + c.daily_rights, 0)
  const duoCount = vips.filter(v => v.duo).length
  return { total: enterpriseCount + vips.length + duoCount, enterpriseCount, individualCount: individual.length, directorCount: directors.length, duoCount,
    enterpriseAmount: contracts.reduce((n,c) => n + Number(c.paid_amount ?? 0), 0), missingPrices: contracts.filter(c => c.paid_amount == null).length,
    individualAmount: individual.reduce((n,v) => n + Number(v.paid_amount), 0), directorAmount: directors.reduce((n,v) => n + Number(v.paid_amount), 0) }
}

export const discountedAmount = (amount: number, discount: Discount = 'standard') => discount === 'free' ? 0 : Math.round(amount * (discount === 'jl_group' ? 80 : 100)) / 100
export const discountLabel = (discount: Discount = 'standard') => discount === 'free' ? 'Gratuité' : discount === 'jl_group' ? 'Réduction JL Group −20 %' : 'Tarif standard'
