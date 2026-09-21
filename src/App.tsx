import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowRight, BarChart3, Bell, Building2, CalendarDays, Check,
  ChevronRight, Clock3, Dumbbell, Gauge, HeartPulse, Home, LogOut, Menu,
  ShieldCheck, Sparkles, Users, X,
} from 'lucide-react'
import { claimDailyAccess, supabaseConfigured } from './lib/supabase'
import { companies, companyMembers, wellServices } from './lib/mock'

type View = 'member' | 'company' | 'prime'

const RESAMANIA_BOOKING_URL = import.meta.env.VITE_RESAMANIA_BOOKING_URL
  || 'https://www.resamania.fr/lp-xplor-active/'

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <img src="/prime-logo-dark.jpg" alt="Prime Sport Santé" />
      <div><strong>PRIME PASS</strong><span>VOTRE SANTÉ EN MOUVEMENT</span></div>
    </div>
  )
}

function Pill({ children, tone = 'blue' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

function Ring({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="ring" style={{ '--value': `${percent * 3.6}deg` } as React.CSSProperties}>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  )
}

function MemberDashboard() {
  const [remaining, setRemaining] = useState(1)
  const [activated, setActivated] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [toast, setToast] = useState('')

  async function activate() {
    if (activated || remaining <= 0) return
    setClaiming(true)
    try {
      const result = await claimDailyAccess()
      if (!result.granted) throw new Error(result.reason || 'Aucun accès disponible')
      setActivated(true)
      setRemaining(result.remaining)
      setToast('Votre accès est activé jusqu’à 22 h')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Activation impossible')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <>
      <section className="hero-card">
        <div className="hero-copy">
          <Pill tone={activated ? 'well' : remaining ? 'blue' : 'muted'}>
            {activated ? 'ACCÈS ACTIVÉ' : `${remaining} ACCÈS DISPONIBLE AUJOURD’HUI`}
          </Pill>
          <h1>{activated ? 'Vous pouvez venir' : 'Bonjour François'}</h1>
          <p>{activated ? 'Présentez votre bracelet à l’entrée. Votre Pass est valable pour la journée.' : 'Activez votre accès avant de vous déplacer au centre.'}</p>
          <button className={`primary-button ${activated ? 'success' : ''}`} onClick={activate} disabled={claiming || activated || !remaining}>
            {activated ? <><Check size={20} /> Accès activé</> : claiming ? 'Activation…' : <>Activer mon accès <ArrowRight size={20} /></>}
          </button>
          {!supabaseConfigured && <small className="demo-note">Mode démonstration · connexion Supabase prête</small>}
        </div>
        <Ring value={activated ? 1 : remaining} max={2} label={activated ? 'Pass actif' : 'sur 2'} />
      </section>

      <section className="occupancy-card">
        <div className="section-title"><div><span>EN DIRECT</span><h2>Fréquentation du centre</h2></div><Pill tone="well">Fluide</Pill></div>
        <div className="occupancy-row"><strong>23</strong><span>personnes présentes</span><em>Capacité confort : 30</em></div>
        <div className="progress"><i style={{ width: '64%' }} /></div>
        <div className="micro-stats"><span><Dumbbell size={16} /> EGYM 5/8</span><span><Activity size={16} /> Cardio 6/12</span><span><Sparkles size={16} /> Well 3/9</span></div>
      </section>

      <div className="section-title standalone"><div><span>PRIME WELL</span><h2>Réserver une prestation</h2></div><a className="text-button" href={RESAMANIA_BOOKING_URL} target="_blank" rel="noreferrer">Ouvrir Resamania <ChevronRight size={17} /></a></div>
      <div className="service-grid">
        {wellServices.map((service) => (
          <a className={`service-card tone-${service.tone}`} key={service.id} href={RESAMANIA_BOOKING_URL} target="_blank" rel="noreferrer" aria-label={`Réserver ${service.name} dans l’application Resamania`}>
            <span className="service-icon">{service.id === 'cryo' ? <Sparkles /> : service.id === 'hydro' ? <HeartPulse /> : service.id === 'photo' ? <Activity /> : <Gauge />}</span>
            <strong>{service.name}</strong><small>{service.duration}</small><ChevronRight size={18} />
          </a>
        ))}
      </div>

      <section className="quota-card">
        <div><span>QUOTA ENTREPRISE</span><h2>28 cryothérapies restantes</h2><p>12 séances consommées sur les 40 incluses cette année.</p></div>
        <Ring value={28} max={40} label="restantes" />
      </section>

      <section className="next-card">
        <div className="date-box"><CalendarDays /><span>RÉSERVER</span></div>
        <div><span>PLANNING PRIME SPORT SANTÉ</span><h3>Réservations dans Resamania</h3><p><Clock3 size={15} /> Consultez les disponibilités et choisissez votre créneau.</p></div>
        <a href={RESAMANIA_BOOKING_URL} target="_blank" rel="noreferrer" aria-label="Ouvrir l’application Resamania"><ChevronRight /></a>
      </section>

      {toast && <div className="toast"><Check size={18} />{toast}<button onClick={() => setToast('')}><X size={16} /></button></div>}
    </>
  )
}

function CompanyDashboard() {
  return (
    <>
      <div className="page-heading"><div><Pill>ESPACE ENTREPRISE</Pill><h1>Tableau de bord</h1><p>Entreprise fondatrice · 2 accès quotidiens</p></div><button className="secondary-button"><Users size={18} /> Inviter un utilisateur</button></div>
      <div className="metric-grid">
        <Metric icon={<ShieldCheck />} value="2" label="accès quotidiens" detail="1 utilisé aujourd’hui" />
        <Metric icon={<Users />} value="8" label="utilisateurs activés" detail="1 onboarding à finaliser" />
        <Metric icon={<BarChart3 />} value="72 %" label="taux d’utilisation" detail="sur les 30 derniers jours" />
        <Metric icon={<Sparkles />} value="28" label="cryothérapies restantes" detail="sur 40 séances incluses" />
      </div>
      <section className="panel chart-panel"><div className="section-title"><div><span>UTILISATION</span><h2>Passages des 7 derniers jours</h2></div><Pill tone="well">+8 %</Pill></div><div className="bars">{[52, 86, 68, 100, 78, 42, 55].map((height, index) => <div key={index}><i style={{ height: `${height}%` }} /><span>{['L','M','M','J','V','S','D'][index]}</span></div>)}</div></section>
      <section className="panel"><div className="section-title"><div><span>ÉQUIPE</span><h2>Utilisateurs</h2></div><button className="text-button">Gérer <ChevronRight size={17} /></button></div><div className="member-list">{companyMembers.map((member) => <div className="member-row" key={member.email}><div className="avatar">{member.name.split(' ').map((part) => part[0]).join('')}</div><div><strong>{member.name}</strong><small>{member.email}</small></div><Pill tone={member.status === 'Actif' ? 'well' : 'back'}>{member.status}</Pill><span>{member.visits} visites</span><button><Menu size={18} /></button></div>)}</div></section>
    </>
  )
}

function Metric({ icon, value, label, detail }: { icon: React.ReactNode; value: string; label: string; detail: string }) {
  return <article className="metric-card"><span>{icon}</span><strong>{value}</strong><h3>{label}</h3><p>{detail}</p></article>
}

function PrimeDashboard() {
  return (
    <>
      <div className="page-heading"><div><Pill tone="prime">CONSOLE PRIME</Pill><h1>Pilotage commercial</h1><p>Objectif : 75 entreprises · 150 accès quotidiens</p></div><button className="secondary-button"><Building2 size={18} /> Nouvelle entreprise</button></div>
      <div className="metric-grid">
        <Metric icon={<Building2 />} value="18 / 75" label="entreprises signées" detail="24 % de l’objectif" />
        <Metric icon={<ShieldCheck />} value="34 / 150" label="accès vendus" detail="116 encore commercialisables" />
        <Metric icon={<Users />} value="136" label="utilisateurs" detail="124 onboardings terminés" />
        <Metric icon={<Gauge />} value="23 / 39" label="occupation actuelle" detail="niveau confortable" />
      </div>
      <section className="panel capacity-panel"><div className="section-title"><div><span>CAPACITÉ</span><h2>Occupation en temps réel</h2></div><Pill tone="well">Fluide</Pill></div><div className="capacity-zones"><Zone name="EGYM" value={5} max={8} color="fit"/><Zone name="Cardio" value={6} max={12} color="fit"/><Zone name="Fonctionnel" value={8} max={10} color="fit"/><Zone name="Well" value={3} max={9} color="well"/></div></section>
      <section className="panel"><div className="section-title"><div><span>PORTEFEUILLE</span><h2>Entreprises</h2></div><button className="text-button">Exporter <ChevronRight size={17} /></button></div><div className="company-list">{companies.map((company) => <div key={company.name}><div className="company-symbol"><Building2 /></div><div><strong>{company.name}</strong><small>{company.members} utilisateurs</small></div><span><b>{company.accesses}</b> accès</span><div className="usage"><i style={{ width: `${company.usage}%` }} /><small>{company.usage} % utilisé</small></div><button><ChevronRight /></button></div>)}</div></section>
    </>
  )
}

function Zone({ name, value, max, color }: { name: string; value: number; max: number; color: string }) {
  return <div><div><strong>{name}</strong><span>{value} / {max}</span></div><div className={`progress progress-${color}`}><i style={{ width: `${value / max * 100}%` }} /></div></div>
}

function App() {
  const [view, setView] = useState<View>(() => (localStorage.getItem('prime-view') as View) || 'member')
  const [menu, setMenu] = useState(false)
  useEffect(() => localStorage.setItem('prime-view', view), [view])
  const title = useMemo(() => view === 'member' ? 'Mon Pass' : view === 'company' ? 'Entreprise' : 'Prime', [view])
  return (
    <div className="app-shell">
      <header><Brand compact /><div className="header-actions"><button aria-label="Notifications"><Bell /></button><button aria-label="Menu" onClick={() => setMenu(!menu)}><Menu /></button></div></header>
      {menu && <div className="account-menu"><strong>Mode de démonstration</strong><button onClick={() => { setView('member'); setMenu(false) }}>Espace utilisateur</button><button onClick={() => { setView('company'); setMenu(false) }}>Espace entreprise</button><button onClick={() => { setView('prime'); setMenu(false) }}>Console Prime</button><hr/><button><LogOut size={16}/> Déconnexion</button></div>}
      <main>{view === 'member' ? <MemberDashboard /> : view === 'company' ? <CompanyDashboard /> : <PrimeDashboard />}</main>
      <nav className="bottom-nav" aria-label="Navigation principale">
        <button className={view === 'member' ? 'active' : ''} onClick={() => setView('member')}><Home /><span>Mon Pass</span></button>
        <a href={RESAMANIA_BOOKING_URL} target="_blank" rel="noreferrer"><CalendarDays /><span>Réserver</span></a>
        <button className={view === 'company' ? 'active' : ''} onClick={() => setView('company')}><Building2 /><span>Entreprise</span></button>
        <button className={view === 'prime' ? 'active' : ''} onClick={() => setView('prime')}><BarChart3 /><span>Prime</span></button>
      </nav>
      <span className="sr-only">Page active : {title}</span>
    </div>
  )
}

export default App
