import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { DiscountChoices, PricingSummary } from './Pricing'
import type { Discount } from './lib/model'
import type { Snapshot, Vip } from './lib/model'
import { addDays, dateLabel, euros, salesSummary, vipTariff, discountedAmount, discountLabel } from './lib/model'

export function SalesDashboard({ snapshot }: { snapshot: Snapshot }) {
  const t = salesSummary(snapshot)
  return <><div className="section-heading"><div><h2>Vue d’ensemble des VIP</h2><p>Contrats actifs au {dateLabel(snapshot.today, true)} · canal de vente JL Bourg</p></div></div><div className="sales-grid">
    <section className="panel"><span>Total des personnes VIP</span><h2>{t.total}</h2><small>{t.enterpriseCount} droits entreprises + {t.individualCount} individuels + {t.directorCount} dirigeants + {t.duoCount} associés duo</small></section>
    <section className="panel"><span>Pass entreprises · {t.enterpriseCount} VIP</span><h2>{euros(t.enterpriseAmount)} HT</h2><small>Prix payés des contrats en cours{t.missingPrices > 0 && ` · ${t.missingPrices} prix à renseigner`}</small></section>
    <section className="panel"><span>VIP individuels · {t.individualCount} titulaire{t.individualCount !== 1 ? 's' : ''}</span><h2>{euros(t.individualAmount)} TTC</h2><small>Prix payés, options duo comprises</small></section>
    <section className="panel"><span>VIP dirigeants · {t.directorCount} titulaire{t.directorCount !== 1 ? 's' : ''}</span><h2>{euros(t.directorAmount)} HT</h2><small>Prix payés, options duo comprises</small></section>
  </div><p className="small">Les montants concernent les contrats en cours, hors contrats futurs, expirés ou suspendus. Les montants HT et TTC sont présentés séparément.</p></>
}
function VipDialog({ children, close }: { children: import('react').ReactNode; close: () => void }) {
 const ref = useRef<HTMLDialogElement>(null)
 useEffect(() => { ref.current?.showModal() }, [])
 return <dialog ref={ref} onCancel={e => { e.preventDefault(); close() }}>{children}</dialog>
}
export function VipAdmin({ snapshot, save }: { snapshot: Snapshot; save: (data: Record<string, unknown>) => Promise<void> }) {
  const [editing, setEditing] = useState<Partial<Vip> | null>(null), [profile, setProfile] = useState('individual'), [duo, setDuo] = useState(false)
  const [paid, setPaid] = useState('1890'), [custom, setCustom] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [discount,setDiscount] = useState<Discount>('standard')
  function open(v?: Vip) { setEditing(v || { id: crypto.randomUUID() }); setProfile(v?.profile || 'individual'); setDuo(v?.duo || false); setPaid(String(v?.paid_amount ?? 1890)); setCustom(!!v); setDiscount(v?.discount || 'standard'); setError('') }
  function pricing(p: string, d: boolean) { setProfile(p); setDuo(d); if (!custom) setPaid(String(discountedAmount(vipTariff(p,d),discount))) }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('')
    const data = Object.fromEntries(new FormData(e.currentTarget))
    try { await save({ ...data, id: editing!.id, profile, duo, discount, paid_amount: paid, active: data.active === 'on' }); setEditing(null) }
    catch(e) { setError(e instanceof Error ? e.message : 'Enregistrement impossible') } finally { setBusy(false) }
  }
  const list = snapshot.vips || []
  return <><div className="page-heading"><div><div className="eyebrow">ADMINISTRATION PRIME</div><h1>VIP individuels et TNS</h1><p>Individuels, dirigeants et personnes associées en duo alterné.</p></div><button className="primary" onClick={() => open()}>Ajouter un VIP</button></div>
    {list.length ? <div className="table-wrap"><table><thead><tr><th>Utilisateur</th><th>Profil</th><th>Duo alterné</th><th>Validité</th><th>Tarif et condition</th><th>Prix payé</th><th>Statut</th><th></th></tr></thead><tbody>{list.map(v => <tr key={v.id}><td><strong>{v.first_name} {v.last_name}</strong><br/><small>{v.email}</small></td><td>{v.profile === 'director' ? 'VIP dirigeant' : 'VIP individuel'}</td><td>{v.duo ? `${v.duo_first_name} ${v.duo_last_name}` : '—'}</td><td>{dateLabel(v.starts_on)} – {dateLabel(v.ends_on, true)}</td><td>{euros(Number(v.list_amount ?? vipTariff(v.profile,v.duo)))} {v.profile === 'director' ? 'HT' : 'TTC'}<br/><small>{discountLabel(v.discount)}</small></td><td>{v.paid_amount == null ? 'À renseigner' : euros(Number(v.paid_amount))} {v.profile === 'director' ? 'HT' : 'TTC'}</td><td>{!v.active ? 'Suspendu' : v.starts_on > snapshot.today ? 'À venir' : v.ends_on < snapshot.today ? 'Expiré' : 'Actif'}</td><td><button className="link-button" onClick={() => open(v)}>Modifier</button></td></tr>)}</tbody></table></div> : <div className="empty">Aucun VIP individuel ou dirigeant enregistré.</div>}
    {editing && <VipDialog close={() => { if (!busy) setEditing(null) }}><div className="modal-heading"><h2>{list.some(v => v.id === editing.id) ? 'Modifier le VIP' : 'Ajouter un VIP'}</h2><button type="button" disabled={busy} onClick={() => setEditing(null)} aria-label="Fermer">×</button></div>{list.some(v => v.id === editing.id) && <PricingSummary pricing={editing} base={vipTariff(editing.profile || profile, editing.duo ?? duo)} tax={(editing.profile || profile) === 'director' ? 'HT' : 'TTC'}/>}<form onSubmit={submit}><fieldset disabled={busy}><div className="form-grid">
      <label className="field">Prénom<input name="first_name" required maxLength={80} defaultValue={editing.first_name}/></label><label className="field">Nom<input name="last_name" required maxLength={80} defaultValue={editing.last_name}/></label>
      <label className="field">E-mail<input name="email" type="email" maxLength={254} defaultValue={editing.email}/></label><label className="field">Téléphone<input name="phone" type="tel" maxLength={40} defaultValue={editing.phone}/></label>
      <label className="field">Profil<select aria-label="Profil" value={profile} onChange={e => pricing(e.target.value,duo)}><option value="individual">VIP individuel · 1 890 € TTC</option><option value="director">VIP dirigeant · 1 690 € HT</option></select></label>
    </div><label className="checkbox"><input type="checkbox" checked={duo} onChange={e => pricing(profile,e.target.checked)}/>Duo alterné · +800 € {profile === 'director' ? 'HT' : 'TTC'}</label>
      {duo && <div className="form-grid"><label className="field">Prénom de la personne associée<input name="duo_first_name" required maxLength={80} defaultValue={editing.duo_first_name || ''}/></label><label className="field">Nom de la personne associée<input name="duo_last_name" required maxLength={80} defaultValue={editing.duo_last_name || ''}/></label></div>}
      <DiscountChoices value={discount} change={d => { setDiscount(d); setCustom(false); setPaid(String(discountedAmount(vipTariff(profile,duo),d))) }}/><p>Prix après réduction : <strong>{euros(discountedAmount(vipTariff(profile,duo),discount))} {profile === 'director' ? 'HT' : 'TTC'}</strong></p><div className="form-grid"><label className="field">Début de validité<input type="date" name="starts_on" required defaultValue={editing.starts_on || snapshot.today}/></label><label className="field">Fin de validité<input type="date" name="ends_on" required defaultValue={editing.ends_on || addDays(snapshot.today,364)}/></label>
      <label className="field">Prix total payé ({profile === 'director' ? 'HT' : 'TTC'}, duo compris)<input readOnly={discount === 'free'} aria-label={`Prix total payé (${profile === 'director' ? 'HT' : 'TTC'}, duo compris)`} type="number" min="0" max="999999999.99" step="0.01" required value={paid} onChange={e => { setPaid(e.target.value); setCustom(true) }}/><small>Tarif de référence : {euros(vipTariff(profile,duo))} {profile === 'director' ? 'HT' : 'TTC'}. <button type="button" className="link-button" onClick={() => { setCustom(false); setPaid(String(discountedAmount(vipTariff(profile,duo),discount))) }}>Appliquer le tarif</button></small></label></div>
      <label className="checkbox"><input type="checkbox" name="active" defaultChecked={editing.active ?? true}/>Contrat actif</label><p className="small">Le duo représente deux personnes et un seul droit alterné. Cette fiche ne crée pas de compte de connexion.</p>
      {error && <div role="alert" className="alert error">{error}</div>}<div className="modal-actions"><button type="button" onClick={() => setEditing(null)}>Retour</button><button className="primary" disabled={!navigator.onLine}> {busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
    </fieldset></form></VipDialog>}
  </>
}
