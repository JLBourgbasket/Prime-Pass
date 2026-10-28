import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ClipboardEvent, FormEvent, ReactElement, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronRight, LogOut, Plus, RefreshCw, Snowflake, Users, X } from 'lucide-react'
import { DiscountChoices, PricingSummary } from './Pricing'
import type { Discount } from './lib/model'
import InactiveClients from './InactiveClients'
import SubscriptionsAdmin from './SubscriptionsAdmin'
import { SalesDashboard, VipAdmin } from './VipAdmin'
import { companyTariff, euros, discountedAmount } from './lib/model'
import { supabase } from './lib/supabase'
import { api } from './lib/api'
import { demoApi, demoEnabled } from './lib/demo'
import { addDays, available, contractAt, cryoUsed, dateLabel, fullName } from './lib/model'
import type { Beneficiary, Company, Contract, Snapshot } from './lib/model'
const call = demoEnabled ? demoApi : api
const newRequest = () => crypto.randomUUID()
type Modal = { kind: 'company' | 'edit-company' | 'beneficiary' | 'claim' | 'cryo' | 'void' | 'contract' | 'cancel'; person?: Beneficiary; contract?: Contract; id?: string; day?: string }

function Brand() { return <div className="brand"><img src="/prime-monogram.webp" alt="Prime Sport Santé"/><div><strong>PASS ENTREPRISE</strong><span>PRIME SPORT SANTÉ</span></div></div> }
function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div> }
function ModalBox({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close() }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={close} aria-label="Fermer"><X size={20}/></button></div>{children}</dialog>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label>{Children.map(children, child => isValidElement(child) && ['input','select','textarea'].includes(String(child.type)) ? cloneElement(child as ReactElement<{ id?: string }>, { id }) : child)}</div>
}
function Photo({ logo, onChange }: { logo: string | null; onChange: (s: string | null) => void }) {
  const [error, setError] = useState(''), [hint, setHint] = useState('')
  const pasteButton = useRef<HTMLButtonElement>(null)
  function importImage(file: Blob) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 250_000) {
      setError('Choisissez une image PNG, JPG ou WebP de moins de 250 Ko.'); return
    }
    const reader = new FileReader()
    reader.onload = () => { setError(''); setHint('Logo importé.'); onChange(String(reader.result)) }
    reader.onerror = () => setError('Lecture de l’image impossible. Réessayez ou choisissez un fichier.')
    reader.readAsDataURL(file)
  }
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const file = Array.from(event.clipboardData.items).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (file) { event.preventDefault(); importImage(file) }
    else if (event.target === pasteButton.current) {
      event.preventDefault(); setError('Copiez une image, puis collez-la ici. Un lien ou du texte ne suffit pas.')
    }
  }
  async function readClipboard() {
    setError(''); setHint('Vous pouvez aussi utiliser Ctrl + V ou Cmd + V sur ce bouton.')
    pasteButton.current?.focus()
    if (!navigator.clipboard?.read) return
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type))
        if (type) { importImage(await item.getType(type)); return }
      }
      setError('Le presse-papiers ne contient pas d’image. Copiez le logo lui-même, puis réessayez.')
    } catch { setHint('Le navigateur ne permet pas le collage direct. Appuyez sur Ctrl + V ou Cmd + V sur ce bouton, ou choisissez un fichier.') }
  }
  return <div onPaste={paste}><Field label="Logo de l’entreprise (facultatif)">
    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) importImage(file) }}/>
    <div><button ref={pasteButton} type="button" className="secondary" onClick={() => void readClipboard()}>Coller un logo</button></div>
    <small>PNG, JPG ou WebP · 250 Ko maximum · collage avec Ctrl + V ou Cmd + V sur le bouton</small>
    {logo && <div className="logo-line"><img src={logo} alt="Aperçu du logo"/><button type="button" className="link-button" onClick={() => { onChange(null); setHint(''); setError('') }}>Retirer</button></div>}
    {hint && <small role="status">{hint}</small>}{error && <span role="alert" className="error-text">{error}</span>}
  </Field></div>
}
function Login({ recovery, onRecovered }: { recovery: boolean; onRecovered: () => void }) {
  const [forgot, setForgot] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setMessage('')
    const f = new FormData(e.currentTarget), email = String(f.get('email') || ''), password = String(f.get('password') || '')
    try {
      if (!supabase) throw new Error('La connexion Prime Pass doit encore être configurée.')
      if (recovery) {
        if (password !== f.get('confirm')) throw new Error('Les mots de passe ne correspondent pas.')
        const r = await supabase.auth.updateUser({ password }); if (r.error) throw r.error
        history.replaceState(null, '', location.pathname); onRecovered()
      } else if (forgot) {
        const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (r.error) throw r.error
        setMessage('Si ce compte existe, un lien de réinitialisation vous sera envoyé.')
      } else { const r = await supabase.auth.signInWithPassword({ email, password }); if (r.error) throw new Error('Connexion impossible. Vérifiez votre e-mail et votre mot de passe.') }
    } catch (e) { setError(e instanceof Error ? e.message : 'Connexion impossible') } finally { setBusy(false) }
  }
  return <div className="login"><img className="login-logo" src="/prime-logo.webp" alt="Prime Sport Santé"/><div className="eyebrow">PASS ENTREPRISE</div><h1>{recovery ? 'Choisir votre mot de passe' : forgot ? 'Retrouver votre accès' : 'Bienvenue sur Prime Pass.'}</h1><p>Votre espace de gestion du Pass Entreprise.</p><form onSubmit={submit}>
    {!recovery && <Field label="Adresse e-mail"><input name="email" type="email" autoComplete="username" required/></Field>}
    {(!forgot || recovery) && <Field label={recovery ? 'Nouveau mot de passe' : 'Mot de passe'}><input name="password" type="password" autoComplete={recovery ? 'new-password' : 'current-password'} minLength={recovery ? 12 : 1} required/></Field>}
    {recovery && <Field label="Confirmer le mot de passe"><input name="confirm" type="password" autoComplete="new-password" minLength={12} required/><small>12 caractères minimum.</small></Field>}
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert success" role="status">{message}</div>}
    <button className="primary full" disabled={busy || !supabase}>{busy ? 'Veuillez patienter…' : recovery ? 'Enregistrer mon mot de passe' : forgot ? 'Recevoir un lien' : 'Se connecter'}<ArrowRight size={17}/></button>
  </form>{!recovery && <button className="link-button login-back" onClick={() => { setForgot(!forgot); setError(''); setMessage('') }}>{forgot ? 'Retour à la connexion' : 'Mot de passe oublié ?'}</button>}
  {!supabase && <div className="alert">La configuration de connexion est en attente.</div>}<p className="small">Votre compte entreprise est ouvert par l’équipe Prime.</p><a className="link-button" href="/souscription">Demander une souscription Prime VIP</a></div>
}

function App() {
  const [session, setSession] = useState<Session | null>(null), [authReady, setAuthReady] = useState(demoEnabled), [recovery, setRecovery] = useState(new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery')
  const [s, setS] = useState<Snapshot | null>(null), [selected, setSelected] = useState<string | null>(null), [tab, setTab] = useState<'usage' | 'people' | 'company'>('usage')
  const [day, setDay] = useState(''), [quotaId, setQuotaId] = useState(''), [modal, setModal] = useState<Modal | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [syncError, setSyncError] = useState(''), [synced, setSynced] = useState(''), [online, setOnline] = useState(navigator.onLine)
  const [logo, setLogo] = useState<string | null>(null), [rights, setRights] = useState(2), [requestId, setRequestId] = useState(newRequest), [historyPage, setHistoryPage] = useState(1)
  const [adminView, setAdminView] = useState<'home' | 'vip' | 'subscriptions' | 'inactive'>(() => new URLSearchParams(location.search).get('view') === 'subscriptions' ? 'subscriptions' : 'home'), [paid, setPaid] = useState('4380'), [customPrice, setCustomPrice] = useState(false)
  const [discount, setDiscount] = useState<Discount>('standard')
  const requests = useRef(0), mounted = useRef(true), generation = useRef(0)
  useEffect(() => {
    if (demoEnabled) return
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setAuthReady(true); if (event === 'PASSWORD_RECOVERY') setRecovery(true); if (!next) { generation.current++; setS(null) } })
    return () => data.subscription.unsubscribe()
  }, [])
  const load = useCallback(async () => {
    if (!demoEnabled && !session) return
    const sequence = ++requests.current; const version = generation.current; setLoading(true)
    try {
      const next = await call('snapshot') as Snapshot
      if (!mounted.current || version !== generation.current || sequence !== requests.current) return
      setS(next); setDay(d => !d || d < next.today ? next.today : d); setSyncError(''); setSynced(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch (e) { if (mounted.current && sequence === requests.current && version === generation.current) setSyncError(e instanceof Error ? e.message : 'Actualisation impossible') } finally { if (mounted.current && sequence === requests.current) setLoading(false) }
  }, [session])
  useEffect(() => { mounted.current = true; void load(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    const status = () => { setOnline(navigator.onLine); if (navigator.onLine) void load() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh); window.addEventListener('online', status); window.addEventListener('offline', status); window.addEventListener('storage', refresh); window.addEventListener('prime-demo-change', refresh)
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', status); window.removeEventListener('offline', status); window.removeEventListener('storage', refresh); window.removeEventListener('prime-demo-change', refresh) }
  }, [load])
  useEffect(() => {
    if (demoEnabled || !session || !supabase) return
    let timer: number | undefined
    const channel = supabase.channel('prime-pass-updates').on('postgres_changes', { event: '*', schema: 'public', table: 'prime_pass_updates' }, () => {
      clearTimeout(timer); timer = window.setTimeout(() => { void load() }, 300)
    }).subscribe(status => { if (status === 'SUBSCRIBED') void load() })
    return () => { clearTimeout(timer); void supabase!.removeChannel(channel) }
  }, [session, load])
  const prime = s?.account.role === 'prime_admin'
  const company = s?.companies.find(c => c.id === (prime ? selected : s.account.company_id))
  const open = (m: Modal) => { setError(''); setRequestId(newRequest()); setLogo(m.kind === 'edit-company' ? company?.logo || null : null); setRights(m.contract?.daily_rights || 2); setPaid(String(m.contract?.paid_amount ?? companyTariff(m.contract?.daily_rights || 2))); setCustomPrice(m.contract?.paid_amount != null); setDiscount(m.contract?.discount || 'standard'); setModal(m) }
  const close = () => { if (!busy) { setModal(null); setError('') } }
  async function mutate(action: string, data: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await call(action, { company_id: company?.id, ...data })
      if(action==='lifecycle_archive_company'){setSelected(null);setAdminView('inactive')}
      setModal(null); setNotice(result?.notice || 'Modification enregistrée.'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Modification impossible'); void load() } finally { setBusy(false) }
  }
  async function logout() { generation.current++; setS(null); setSelected(null); await supabase?.auth.signOut(); setSession(null) }
  function chooseCompany(c: Company) { setSelected(c.id); setTab('usage'); setQuotaId(''); setHistoryPage(1) }
  function chooseDay(d: string) { setDay(d); setTab('usage') }
  const people = s?.beneficiaries.filter(p => p.company_id === company?.id) || []
  const activePeople = people.filter(p => p.active)
  const contracts = s?.contracts.filter(c => c.company_id === company?.id).sort((a, b) => b.starts_on.localeCompare(a.starts_on)) || []
  const current = s && company ? contractAt(s, company.id, s.today) : undefined
  const quota = contracts.find(c => c.id === quotaId) || current || contracts[0]
  const used = s ? cryoUsed(s, quota) : 0
  const selectedContract = s && company ? contractAt(s, company.id, day) : undefined
  const claims = s?.claims.filter(c => c.company_id === company?.id && c.access_date === day && !c.cancelled_at) || []
  const nameFor = (id: string) => fullName(people.find(p => p.id === id))
  const historyRows = s && company ? [
    ...s.claims.filter(c => c.company_id === company.id).map(c => ({ id: c.id, day: c.access_date, name: nameFor(c.beneficiary_id), type: 'Droit quotidien', status: c.cancelled_at ? 'Annulé · droit libéré' : 'Attribué', sort: c.created_at, claim: c, cryo: null })),
    ...s.cryo.filter(c => c.company_id === company.id).map(c => ({ id: c.id, day: c.performed_on, name: nameFor(c.beneficiary_id), type: 'Séance cryo', status: c.voided_at ? `Corrigée · ${c.void_reason}` : 'Décomptée par Prime', sort: c.created_at, claim: null, cryo: c })),
  ].sort((a, b) => b.day.localeCompare(a.day) || b.sort.localeCompare(a.sort)) : []

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!modal) return
    const fields = Object.fromEntries(new FormData(e.currentTarget).entries()), kind = modal.kind
    if (kind === 'company') void mutate('create_company', { ...fields, logo, discount, paid_amount: paid, daily_rights: rights, request_id: requestId })
    if (kind === 'edit-company') void mutate('update_company', { ...fields, logo, active: fields.active === 'on' })
    if (kind === 'beneficiary') void mutate(modal.person ? 'update_beneficiary' : 'add_beneficiary', { ...fields, ...(modal.person ? { id: modal.person.id, active: fields.active === 'on' } : {}) })
    if (kind === 'claim') void mutate('claim', { ...fields, access_date: modal.day, request_id: requestId })
    if (kind === 'cancel') void mutate('cancel_claim', { id: modal.id })
    if (kind === 'cryo') void mutate('record_cryo', { ...fields, request_id: requestId })
    if (kind === 'void') void mutate('void_cryo', { ...fields, id: modal.id })
    if (kind === 'contract') void mutate(modal.contract ? 'update_contract' : 'add_contract', { ...fields, discount, paid_amount: paid, daily_rights: rights, ...(modal.contract ? { id: modal.contract.id } : {}) })
  }

  return <div className="app-shell">
    {demoEnabled && <div className="demo-banner"><span>Démonstration · données fictives · aucun e-mail envoyé</span><div><button onClick={async () => { await call('demo_role', { role: 'company' }); setSelected(null); setTab('usage'); await load() }}>Entreprise</button><button onClick={async () => { await call('demo_role', { role: 'prime_admin' }); setSelected(null); setTab('usage'); await load() }}>Administration Prime</button></div></div>}
    <header className="app-header"><Brand/>{s && <div className="account-actions"><span>{prime ? 'Administration Prime' : 'Espace entreprise'}</span>{!demoEnabled && <button className="icon-button" onClick={() => void logout()} aria-label="Se déconnecter"><LogOut size={20}/></button>}</div>}</header>
    {!authReady ? <Empty>Chargement…</Empty> : (!session && !demoEnabled) || recovery ? <Login recovery={recovery} onRecovered={() => { setRecovery(false); void load() }}/>
      : !s ? <main className="page"><Empty>{loading ? 'Chargement de votre espace…' : syncError || 'Chargement…'}</Empty><div className="actions"><button onClick={() => void load()}>Réessayer</button><button onClick={() => void logout()}>Se déconnecter</button></div></main>
      : <main className="page">
        {(!online || syncError) && <div className="alert error" role="alert">{!online ? 'Hors connexion. Les informations affichées peuvent être anciennes ; aucune modification ne sera confirmée.' : `${syncError} Les données affichées peuvent être anciennes.`}</div>}
        <div className="sync-line"><span>{loading ? 'Actualisation…' : `Dernière actualisation : ${synced}`}</span><button className="link-button" onClick={() => void load()} disabled={loading}><RefreshCw size={13}/> Actualiser</button></div>
        {notice && <div className="alert success" role="status"><Check size={17}/><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Fermer le message"><X size={16}/></button></div>}
        {!modal && error && <div role="alert" className="alert error">{error}</div>}
        {prime && !company && <nav className="tabs" aria-label="Administration"><button className={adminView === 'home' ? 'active' : ''} onClick={() => setAdminView('home')}>Accueil et entreprises</button><button className={adminView === 'vip' ? 'active' : ''} onClick={() => setAdminView('vip')}>VIP individuels et TNS</button>{!demoEnabled && <button className={adminView === 'subscriptions' ? 'active' : ''} onClick={() => setAdminView('subscriptions')}>Souscriptions</button>}<button className={adminView === 'inactive' ? 'active' : ''} onClick={() => setAdminView('inactive')}>Clients désactivés</button></nav>}
        {prime && !company && adminView === 'inactive' ? <InactiveClients snapshot={s} action={async (name,data) => { const r=await call(name,data);setNotice(r.notice || 'Modification enregistrée.');await load() }}/> : prime && !company && adminView === 'subscriptions' ? <SubscriptionsAdmin refresh={load}/> : prime && !company && adminView === 'vip' ? <VipAdmin snapshot={s} archive={async vip => { const r=await call('lifecycle_archive_vip',{id:vip.id});setNotice(r.notice || 'Fiche désactivée.');setAdminView('inactive');await load() }} save={async data => { await call('save_vip', data); await load() }}/> : prime && !company ? <>
          <SalesDashboard snapshot={s}/>
          <div className="page-heading"><div><div className="eyebrow">ADMINISTRATION PRIME</div><h1>Entreprises</h1><p>Les comptes et les droits du Pass Entreprise.</p></div><button className="primary" onClick={() => open({ kind: 'company' })}><Plus size={18}/>Créer une entreprise</button></div>
          {s.companies.some(c=>c.active) ? <div className="table-wrap"><table><thead><tr><th>Entreprise</th><th>Droits / jour</th><th>Cryo restantes</th><th>Prix payé HT</th><th>Contrat</th><th>Statut</th><th aria-label="Consulter"></th></tr></thead><tbody>{s.companies.filter(c=>c.active).map(c => { const ct = contractAt(s, c.id, s.today); return <tr key={c.id}><td><button className="company-link" onClick={() => chooseCompany(c)}>{c.logo && <img src={c.logo} alt=""/>}<strong>{c.name}</strong></button></td><td>{ct?.daily_rights ?? '—'}</td><td>{ct ? `${ct.cryo_quota - cryoUsed(s, ct)} / ${ct.cryo_quota}` : '—'}</td><td>{ct?.paid_amount == null ? 'À renseigner' : euros(Number(ct.paid_amount))}</td><td>{ct ? `Jusqu’au ${dateLabel(ct.ends_on)}` : 'Aucun contrat en cours'}</td><td><span className={`badge ${c.active ? '' : 'neutral'}`}>{c.active ? 'Actif' : 'Suspendu'}</span></td><td><button className="icon-button" aria-label={`Consulter ${c.name}`} onClick={() => chooseCompany(c)}><ChevronRight size={19}/></button></td></tr> })}</tbody></table></div> : <Empty>Aucune entreprise. Créez le premier compte pour commencer.</Empty>}
        </> : company ? <>
          {prime && <button className="link-button back" onClick={() => { setSelected(null); setQuotaId('') }}><ArrowLeft size={16}/>Entreprises</button>}
          <div className="company-heading"><div><div className="eyebrow">{prime ? 'FICHE ENTREPRISE' : 'ESPACE ENTREPRISE'}</div><h1>{company.name}</h1><p>Votre Pass Entreprise, simplement.</p></div>{company.logo && <img className="company-logo" src={company.logo} alt={`Logo ${company.name}`}/>}</div>
          {prime && company.active && <div className="actions"><button className="link-button danger-text" disabled={busy} onClick={() => {if(window.confirm(`Supprimer ${company.name} de la liste active ? La fiche sera déplacée vers Clients désactivés et l’accès entreprise sera bloqué.`))void mutate('lifecycle_archive_company',{id:company.id})}}>Supprimer le compte entreprise</button></div>}
          {prime && contracts.length > 0 && <section className="panel"><div className="section-heading"><div><h2>Tarif et règlement</h2><p>Contrat du {dateLabel((current || contracts[0]).starts_on)} au {dateLabel((current || contracts[0]).ends_on,true)}</p></div><button className="secondary" onClick={() => open({kind:'contract',contract:current || contracts[0]})}>Modifier le tarif</button></div><PricingSummary pricing={current || contracts[0]} base={companyTariff((current || contracts[0]).daily_rights)} tax="HT"/></section>}
          {!company.active && <div className="alert">Compte entreprise suspendu.</div>}
          <nav className="tabs" aria-label="Navigation entreprise"><button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}><CalendarDays size={17}/>Utilisation</button><button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}><Users size={17}/>Administration utilisateurs</button>{prime && <button className={tab === 'company' ? 'active' : ''} onClick={() => setTab('company')}>Compte et contrats</button>}</nav>
          {tab === 'usage' && <>
            <section className="today-panel"><div><div className="eyebrow">AUJOURD’HUI</div><h2>{dateLabel(s.today, true)}</h2><div className="today-count"><strong>{available(s, company.id, s.today)}</strong><span>droit{available(s, company.id, s.today) > 1 ? 's' : ''} disponible{available(s, company.id, s.today) > 1 ? 's' : ''}<small>sur {current?.daily_rights || 0} droit{current?.daily_rights !== 1 ? 's' : ''} quotidien{current?.daily_rights !== 1 ? 's' : ''}</small></span></div><div className="today-names">{s.claims.filter(c => c.company_id === company.id && c.access_date === s.today && !c.cancelled_at).map(c => <span key={c.id}>{nameFor(c.beneficiary_id)} <button className="link-button" disabled={busy || !online} onClick={() => open({ kind: 'cancel', id: c.id })}>Annuler</button></span>)}</div>{!current && <p>Aucun contrat en cours pour aujourd’hui.</p>}</div><button className="primary" disabled={!online || !company.active || available(s, company.id, s.today) < 1 || !activePeople.length} onClick={() => open({ kind: 'claim', day: s.today })}><Plus size={17}/>Utiliser un droit aujourd’hui</button></section>
            {!activePeople.length && <div className="alert">Ajoutez un bénéficiaire dans « Administration utilisateurs » pour attribuer un droit.</div>}
            <div className="section-heading"><div><h2>Les 14 prochains jours</h2><p>Choisissez une date pour attribuer ou libérer un droit.</p></div></div>
            <div className="planning">{Array.from({ length: 14 }, (_, i) => addDays(s.today, i + 1)).map(d => { const ct = contractAt(s, company.id, d), remaining = available(s, company.id, d), names = s.claims.filter(c => c.company_id === company.id && c.access_date === d && !c.cancelled_at).map(c => nameFor(c.beneficiary_id)); return <button key={d} className={`day ${d === day ? 'selected' : ''}`} aria-pressed={d === day} onClick={() => chooseDay(d)}><span>{dateLabel(d)}</span><strong>{ct ? remaining ? `${remaining} disponible${remaining > 1 ? 's' : ''}` : 'Complet' : 'Hors contrat'}</strong><small>{names.length ? names.join(', ') : 'Aucun droit attribué'}</small></button> })}</div>
            {day !== s.today && <section className="panel"><div className="section-heading"><h2>{dateLabel(day, true)}</h2><button className="secondary" disabled={!online || !company.active || !selectedContract || available(s, company.id, day) < 1 || !activePeople.length} onClick={() => open({ kind: 'claim', day })}><Plus size={16}/>Prendre un droit</button></div><p>{selectedContract ? `${available(s, company.id, day)} droit(s) disponible(s) sur ${selectedContract.daily_rights}. Annulation libre, droit immédiatement libéré.` : 'Cette date ne dispose pas de contrat.'}</p>{claims.length ? <ul className="allocation-list">{claims.map(c => <li key={c.id}><span>{nameFor(c.beneficiary_id)}</span><button className="link-button" disabled={busy || !online} onClick={() => open({ kind: 'cancel', id: c.id })}>Annuler ce droit</button></li>)}</ul> : <Empty>Aucun droit attribué pour cette date.</Empty>}</section>}
            <section className="panel"><div className="section-heading"><h2><Snowflake size={19}/>Cryothérapie</h2>{prime && <button className="secondary" disabled={!activePeople.length || !company.active || !online} onClick={() => open({ kind: 'cryo' })}>Enregistrer une séance réalisée</button>}</div>{contracts.length > 1 && <Field label="Contrat du quota"><select value={quota?.id} onChange={e => setQuotaId(e.target.value)}>{contracts.map(c => <option key={c.id} value={c.id}>{dateLabel(c.starts_on)} – {dateLabel(c.ends_on)}</option>)}</select></Field>}<div className="quota-stats"><div><strong>{quota?.cryo_quota || 0}</strong><span>séances incluses</span></div><div><strong>{used}</strong><span>séances utilisées</span></div><div><strong>{quota ? quota.cryo_quota - used : 0}</strong><span>séances restantes</span></div></div><p className="small">20 séances par droit quotidien acheté. Les consommations sont enregistrées par Prime.</p></section>
            <div className="section-heading"><h2>Historique</h2></div>{historyRows.length ? <><div className="table-wrap"><table><thead><tr><th>Date</th><th>Bénéficiaire</th><th>Utilisation</th><th>Statut</th><th aria-label="Action"></th></tr></thead><tbody>{historyRows.slice(0, historyPage * 15).map(r => <tr key={r.id}><td>{dateLabel(r.day)}</td><td>{r.name}</td><td>{r.type}</td><td><span className="history-status">{r.status}</span></td><td>{r.claim && !r.claim.cancelled_at && <button className="link-button" disabled={!online || busy} onClick={() => open({ kind: 'cancel', id: r.id })}>Annuler</button>}{prime && r.cryo && !r.cryo.voided_at && <button className="link-button" disabled={!online || busy} onClick={() => open({ kind: 'void', id: r.id })}>Corriger</button>}</td></tr>)}</tbody></table></div>{historyRows.length > historyPage * 15 && <button className="load-more" onClick={() => setHistoryPage(p => p + 1)}>Voir la suite de l’historique</button>}</> : <Empty>Aucune utilisation enregistrée.</Empty>}
          </>}
          {tab === 'people' && <><div className="section-heading"><div><h2>Bénéficiaires</h2><p>{activePeople.length} utilisateur{activePeople.length !== 1 ? 's' : ''} actif{activePeople.length !== 1 ? 's' : ''} · un compte partagé pour l’entreprise.</p></div><button className="primary" disabled={!company.active || !online} onClick={() => open({ kind: 'beneficiary' })}><Plus size={17}/>Ajouter un utilisateur</button></div>{people.length ? <div className="table-wrap"><table><thead><tr><th>Nom et prénom</th><th>Statut</th><th>Action</th></tr></thead><tbody>{people.map(p => <tr key={p.id}><td>{fullName(p)}</td><td><span className={`badge ${p.active ? '' : 'neutral'}`}>{p.active ? 'Actif' : 'Inactif'}</span></td><td><button className="link-button" disabled={!online} onClick={() => open({ kind: 'beneficiary', person: p })}>Modifier</button></td></tr>)}</tbody></table></div> : <Empty>Ajoutez les personnes qui pourront utiliser les droits de votre entreprise.</Empty>}</>}
          {tab === 'company' && prime && <><section className="panel"><div className="section-heading"><h2>Compte entreprise</h2><button className="secondary" onClick={() => open({ kind: 'edit-company' })}>Modifier</button></div><dl className="contact-grid"><div><dt>Contact</dt><dd>{company.contact_name}</dd></div><div><dt>E-mail du compte partagé</dt><dd>{company.email}</dd></div><div><dt>Téléphone</dt><dd>{company.phone}</dd></div></dl><button className="link-button" disabled={busy} onClick={() => void mutate('send_access_link', {})}>Renvoyer le lien de définition du mot de passe</button></section><div className="section-heading"><h2>Contrats</h2><button className="primary" onClick={() => open({ kind: 'contract' })}><Plus size={17}/>Nouveau contrat</button></div>{contracts.map(c => <section className="panel" key={c.id}><div className="section-heading"><h3>{dateLabel(c.starts_on, true)} – {dateLabel(c.ends_on, true)}</h3>{!c.retired_at && <button className="link-button" onClick={() => open({ kind: 'contract', contract: c })}>Modifier</button>}</div>{c.retired_at && <p className="badge neutral">Contrat clôturé</p>}<PricingSummary pricing={c} base={companyTariff(c.daily_rights)} tax="HT"/><p>{c.daily_rights} droits quotidiens · {c.cryo_quota} séances cryo incluses · {cryoUsed(s, c)} utilisées</p></section>)}<h2>Dernières opérations</h2><ul className="audit-list">{s.audit.filter(a => a.company_id === company.id).slice(0, 30).map(a => <li key={a.id}><span>{dateLabel(a.created_at)} · {actionLabel(a.action)}</span>{a.detail.input?.reason && <small>{a.detail.input.reason}</small>}</li>)}</ul></>}
        </> : <Empty>Aucune entreprise rattachée à ce compte. Contactez Prime.</Empty>}
      </main>}
    <footer className="app-footer"><span>Prime Sport Santé</span><span>Prime Pass Entreprise</span></footer>
    {modal && s && <ModalBox close={close} title={modalTitle(modal)}><form onSubmit={submit}><fieldset disabled={busy}>
      {(modal.kind === 'company' || modal.kind === 'edit-company') && <><div className="form-grid"><Field label="Nom de l’entreprise"><input name="name" required maxLength={160} defaultValue={modal.kind === 'edit-company' ? company?.name : ''}/></Field><Field label="Contact"><input name="contact_name" required maxLength={160} defaultValue={modal.kind === 'edit-company' ? company?.contact_name : ''}/></Field>{modal.kind === 'company' && <Field label="Adresse e-mail du contact et du compte partagé"><input name="email" type="email" required maxLength={254}/></Field>}<Field label="Téléphone du contact"><input name="phone" type="tel" required maxLength={40} defaultValue={modal.kind === 'edit-company' ? company?.phone : ''}/></Field></div><Photo logo={logo} onChange={setLogo}/>{modal.kind === 'edit-company' && <input name="active" type="hidden" value="on"/>}</>}
      {(modal.kind === 'company' || modal.kind === 'contract') && <><div className="form-grid"><Field label="Début du contrat"><input name="starts_on" type="date" required defaultValue={modal.contract?.starts_on || (modal.kind === 'contract' && contracts[0] ? addDays(contracts[0].ends_on, 1) : s.today)}/></Field><Field label="Fin du contrat"><input name="ends_on" type="date" required defaultValue={modal.contract?.ends_on || ''}/></Field><Field label="Droits quotidiens achetés"><input type="number" required min={1} max={150} step={1} value={rights} onChange={e => { const n = Number(e.target.value); setRights(n); if (!customPrice) setPaid(String(discountedAmount(companyTariff(n),discount))) }}/></Field><Field label="Quota cryo inclus"><input readOnly value={rights * 20}/><small>20 séances par droit quotidien.</small></Field><Field label="Prix total payé pour le contrat (HT)"><input readOnly={discount === 'free'} type="number" required min={0} max={999999999.99} step="0.01" value={paid} onChange={e => { setPaid(e.target.value); setCustomPrice(true) }}/><small>Tarif annuel : {euros(companyTariff(rights))} HT · 2 690 € pour le premier droit, puis 1 690 € par droit supplémentaire. <button type="button" className="link-button" onClick={() => { setPaid(String(discountedAmount(companyTariff(rights),discount))); setCustomPrice(false) }}>Appliquer le tarif</button></small></Field></div><DiscountChoices value={discount} change={d => { setDiscount(d); setPaid(String(discountedAmount(companyTariff(rights),d))); setCustomPrice(false) }}/><p>Prix après réduction : <strong>{euros(discountedAmount(companyTariff(rights),discount))} HT</strong></p>{modal.kind === 'company' && <p className="small">Un lien de définition du mot de passe sera demandé par e-mail. Aucun compte personnel n’est créé pour les bénéficiaires.</p>}</>}
      {modal.kind === 'beneficiary' && <><div className="form-grid"><Field label="Prénom"><input name="first_name" required maxLength={80} defaultValue={modal.person?.first_name}/></Field><Field label="Nom"><input name="last_name" required maxLength={80} defaultValue={modal.person?.last_name}/></Field></div>{modal.person && <><label className="checkbox"><input name="active" type="checkbox" defaultChecked={modal.person.active}/>Bénéficiaire actif</label><p className="small">La désactivation libère ses droits d’aujourd’hui et des jours à venir. L’historique est conservé.</p></>}</>}
      {(modal.kind === 'claim' || modal.kind === 'cryo') && <><Field label="Bénéficiaire"><select name="beneficiary_id" required defaultValue=""><option value="" disabled>Choisir un nom</option>{activePeople.filter(p => modal.kind !== 'claim' || !s.claims.some(c => c.beneficiary_id === p.id && c.access_date === modal.day && !c.cancelled_at)).map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}</select></Field>{modal.kind === 'claim' ? <p>Pour le <strong>{dateLabel(modal.day!, true)}</strong>. Ce droit pourra être annulé à tout moment.</p> : <Field label="Date de la séance réalisée"><input name="performed_on" type="date" required max={s.today} defaultValue={s.today}/></Field>}</>}
      {modal.kind === 'void' && <><p>Le crédit cryo sera restitué au contrat concerné. La séance et sa correction resteront dans l’historique.</p><Field label="Motif de la correction"><textarea name="reason" required minLength={1} maxLength={500} rows={3}/></Field></>}
      {modal.kind === 'cancel' && <p>Le droit sera immédiatement disponible pour une autre personne à la même date. L’annulation restera dans l’historique.</p>}
      {error && <div className="alert error" role="alert">{error}</div>}<div className="modal-actions"><button type="button" onClick={close}>Retour</button><button className="primary" type="submit" disabled={!online}>{busy ? 'Enregistrement…' : modal.kind === 'cancel' ? 'Annuler le droit et le libérer' : modal.kind === 'void' ? 'Corriger et restituer le crédit' : modal.kind === 'company' ? 'Créer le compte entreprise' : modal.kind === 'cryo' ? 'Décompter une séance' : 'Confirmer'}</button></div>
    </fieldset></form></ModalBox>}
  </div>
}
function modalTitle(m: Modal) { return ({ company: 'Créer une entreprise', 'edit-company': 'Modifier le compte entreprise', beneficiary: m.person ? 'Modifier le bénéficiaire' : 'Ajouter un utilisateur', claim: 'Attribuer un droit quotidien', cryo: 'Enregistrer une séance cryo', void: 'Corriger un décompte cryo', contract: m.contract ? 'Modifier le contrat' : 'Renouveler le contrat', cancel: 'Annuler un droit' })[m.kind] }
function actionLabel(action: string) { return ({ create_company: 'Création du compte', update_company: 'Modification du compte', add_contract: 'Nouveau contrat', update_contract: 'Modification du contrat', add_beneficiary: 'Ajout d’un bénéficiaire', update_beneficiary: 'Modification d’un bénéficiaire', claim: 'Attribution d’un droit', cancel_claim: 'Annulation d’un droit', record_cryo: 'Séance cryo décomptée', void_cryo: 'Correction cryo' } as Record<string, string>)[action] || action }
export default App
