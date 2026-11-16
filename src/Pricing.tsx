import type { Discount, Pricing } from './lib/model'
import { discountedAmount, discountLabel, euros } from './lib/model'
export function DiscountChoices({value,change}:{value:Discount;change:(d:Discount)=>void}) {
 return <div className="discount-choices"><strong>Conditions tarifaires · administration Prime</strong><label className="checkbox"><input type="checkbox" checked={value==='jl_group'} onChange={e=>change(e.target.checked?'jl_group':'standard')}/>Réduction JL Group −20 %</label><label className="checkbox"><input type="checkbox" checked={value==='free'} onChange={e=>change(e.target.checked?'free':'standard')}/>Gratuité</label><small>Choix exclusifs. La réduction s’applique à l’ensemble de l’offre, options duo comprises.</small></div>
}
export function PricingSummary({pricing,base,tax}:{pricing:Pricing;base:number;tax:string}) {
 const list=Number(pricing.list_amount??base),due=Number(pricing.amount_due??discountedAmount(list,pricing.discount))
 return <dl className="pricing-summary"><div><dt>Tarif annuel de référence</dt><dd>{euros(list)} {tax}</dd></div><div><dt>Condition appliquée</dt><dd>{discountLabel(pricing.discount)}</dd></div><div><dt>Prix après réduction</dt><dd>{euros(due)} {tax}</dd></div><div><dt>Prix payé</dt><dd>{pricing.paid_amount==null?'À renseigner':`${euros(Number(pricing.paid_amount))} ${tax}`}</dd></div></dl>
}
