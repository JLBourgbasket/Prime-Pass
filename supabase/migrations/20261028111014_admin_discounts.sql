begin;
alter table prime_pass.contracts
 add column discount text not null default 'standard' check(discount in ('standard','jl_group','free')),
 add column list_amount numeric(12,2) generated always as (2690+(daily_rights-1)*1690) stored,
 add column amount_due numeric(12,2) generated always as (round((2690+(daily_rights-1)*1690) * case discount when 'free' then 0 when 'jl_group' then 0.8 else 1 end,2)) stored,
 add constraint contracts_free_paid check(discount<>'free' or (paid_amount is not null and paid_amount=0));
alter table prime_pass.vips
 add column discount text not null default 'standard' check(discount in ('standard','jl_group','free')),
 add column list_amount numeric(12,2) generated always as ((case when profile='director' then 1690 else 1890 end)+(case when duo then 800 else 0 end)) stored,
 add column amount_due numeric(12,2) generated always as (round(((case when profile='director' then 1690 else 1890 end)+(case when duo then 800 else 0 end)) * case discount when 'free' then 0 when 'jl_group' then 0.8 else 1 end,2)) stored,
 add constraint vips_free_paid check(discount<>'free' or (paid_amount is not null and paid_amount=0));
alter table prime_pass.subscriptions add column discount text not null default 'standard' check(discount in ('standard','jl_group','free'));
create or replace function public.prime_pass_execute(p_actor uuid, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 a prime_pass.accounts; co prime_pass.companies; ct prime_pass.contracts; be prime_pass.beneficiaries;
 cl prime_pass.claims; cr prime_pass.cryo; cid uuid; bid uuid; rid uuid; target uuid; d date;
 today date := (now() at time zone 'Europe/Paris')::date; n integer; result jsonb; old_data jsonb; vip prime_pass.vips;
begin
 select * into a from prime_pass.accounts where user_id=p_actor and active;
 if a.user_id is null then raise exception 'Compte non autorisé'; end if;
 if a.role='company' and not exists(select 1 from prime_pass.companies where id=a.company_id and active) then raise exception 'Compte entreprise suspendu'; end if;
 if p_action='snapshot' then
  -- A single SQL statement gives a consistent view of all counters and lists.
  select jsonb_build_object('account',to_jsonb(a),'today',today,
   'companies',coalesce((select jsonb_agg(x order by x.name) from prime_pass.companies x where a.role='prime_admin' or x.id=a.company_id),'[]'::jsonb),
   'contracts',coalesce((select jsonb_agg(x order by x.starts_on) from prime_pass.contracts x where a.role='prime_admin' or x.company_id=a.company_id),'[]'::jsonb),
   'beneficiaries',coalesce((select jsonb_agg(x order by x.last_name,x.first_name) from prime_pass.beneficiaries x where a.role='prime_admin' or x.company_id=a.company_id),'[]'::jsonb),
   'claims',coalesce((select jsonb_agg(x order by x.created_at desc) from prime_pass.claims x where a.role='prime_admin' or x.company_id=a.company_id),'[]'::jsonb),
   'cryo',coalesce((select jsonb_agg(x order by x.created_at desc) from prime_pass.cryo x where a.role='prime_admin' or x.company_id=a.company_id),'[]'::jsonb),
   'vips',case when a.role='prime_admin' then coalesce((select jsonb_agg(x order by x.last_name,x.first_name) from prime_pass.vips x),'[]'::jsonb) else '[]'::jsonb end,
   'audit',coalesce((select jsonb_agg(x order by x.id desc) from (select * from prime_pass.audit where a.role='prime_admin' order by id desc limit 300) x),'[]'::jsonb)
  ) into result;
  return result;
 end if;
 if p_action='save_vip' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  target := (p_data->>'id')::uuid;
  if target is null then raise exception 'Identifiant VIP requis'; end if;
  -- Serialize edits/retries on this record and keep an audit trail.
  perform pg_advisory_xact_lock(hashtextextended(target::text,0));
  select to_jsonb(x) into old_data from prime_pass.vips x where id=target;
  insert into prime_pass.vips(id,first_name,last_name,email,phone,profile,duo,duo_first_name,duo_last_name,starts_on,ends_on,paid_amount,active,discount)
  values(target,trim(p_data->>'first_name'),trim(p_data->>'last_name'),lower(trim(coalesce(p_data->>'email',''))),trim(coalesce(p_data->>'phone','')),p_data->>'profile',(p_data->>'duo')::boolean,
    case when (p_data->>'duo')::boolean then trim(p_data->>'duo_first_name') end,case when (p_data->>'duo')::boolean then trim(p_data->>'duo_last_name') end,
    (p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'paid_amount')::numeric,(p_data->>'active')::boolean,coalesce(p_data->>'discount',old_data->>'discount','standard'))
  on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,phone=excluded.phone,profile=excluded.profile,duo=excluded.duo,duo_first_name=excluded.duo_first_name,duo_last_name=excluded.duo_last_name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,paid_amount=excluded.paid_amount,active=excluded.active,discount=excluded.discount
  returning * into vip;
  if old_data is distinct from to_jsonb(vip) then
    insert into prime_pass.audit(actor_id,action,detail) values(p_actor,p_action,jsonb_build_object('before',old_data,'after',to_jsonb(vip)));
  end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='creation_status' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  select to_jsonb(x) into result from prime_pass.companies x where request_id=(p_data->>'request_id')::uuid;
  return result;
 end if;
 if p_action='create_company' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  select * into co from prime_pass.companies where request_id=(p_data->>'request_id')::uuid;
  if co.id is not null then return to_jsonb(co); end if;
  insert into prime_pass.companies(name,contact_name,email,phone,logo,request_id)
   values(trim(p_data->>'name'),trim(p_data->>'contact_name'),lower(trim(p_data->>'email')),trim(p_data->>'phone'),nullif(p_data->>'logo',''),(p_data->>'request_id')::uuid) returning * into co;
  insert into prime_pass.accounts(user_id,role,company_id) values((p_data->>'auth_user_id')::uuid,'company',co.id);
  insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights,paid_amount,discount) values(co.id,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer,nullif(p_data->>'paid_amount','')::numeric,coalesce(p_data->>'discount','standard'));
  insert into prime_pass.audit(company_id,actor_id,action,detail) values(co.id,p_actor,p_action,jsonb_build_object('name',co.name,'discount',coalesce(p_data->>'discount','standard'),'paid_amount',p_data->'paid_amount'));
  return to_jsonb(co);
 end if;
 cid := (p_data->>'company_id')::uuid;
 if cid is null or (a.role<>'prime_admin' and a.company_id<>cid) then raise exception 'Entreprise non autorisée'; end if;
 -- All mutations for one company share this lock, including cancellations and corrections.
 select * into co from prime_pass.companies where id=cid for update;
 if co.id is null then raise exception 'Entreprise introuvable'; end if;
 if not co.active and p_action not in ('update_company','cancel_claim','void_cryo') then raise exception 'Entreprise suspendue'; end if;
 if p_action='update_company' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  old_data:=to_jsonb(co);
  update prime_pass.companies set name=trim(p_data->>'name'),contact_name=trim(p_data->>'contact_name'),phone=trim(p_data->>'phone'),logo=nullif(p_data->>'logo',''),active=(p_data->>'active')::boolean where id=cid;
 elsif p_action in ('add_contract','update_contract') then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  target:=nullif(p_data->>'id','')::uuid;
  if exists(select 1 from prime_pass.contracts where company_id=cid and (target is null or id<>target) and starts_on<=(p_data->>'ends_on')::date and ends_on>=(p_data->>'starts_on')::date) then raise exception 'Les périodes de contrat ne peuvent pas se chevaucher'; end if;
  if p_action='add_contract' then
   insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights,paid_amount,discount) values(cid,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer,nullif(p_data->>'paid_amount','')::numeric,coalesce(p_data->>'discount','standard'));
  else
   select * into ct from prime_pass.contracts where id=target and company_id=cid;
   if ct.id is null then raise exception 'Contrat introuvable'; end if;
   old_data:=to_jsonb(ct);
   if exists(select 1 from prime_pass.claims where contract_id=target and cancelled_at is null group by access_date having count(*)>(p_data->>'daily_rights')::integer)
    or (select count(*) from prime_pass.cryo where contract_id=target and voided_at is null)>(p_data->>'daily_rights')::integer*20 then raise exception 'Les droits ne peuvent pas être inférieurs aux utilisations enregistrées'; end if;
   if exists(select 1 from prime_pass.claims where contract_id=target and cancelled_at is null and access_date not between (p_data->>'starts_on')::date and (p_data->>'ends_on')::date)
    or exists(select 1 from prime_pass.cryo where contract_id=target and voided_at is null and performed_on not between (p_data->>'starts_on')::date and (p_data->>'ends_on')::date) then raise exception 'La période doit couvrir les utilisations enregistrées'; end if;
   update prime_pass.contracts set starts_on=(p_data->>'starts_on')::date, ends_on=(p_data->>'ends_on')::date,daily_rights=(p_data->>'daily_rights')::integer,paid_amount=case when p_data ? 'paid_amount' then nullif(p_data->>'paid_amount','')::numeric else paid_amount end,discount=coalesce(p_data->>'discount',discount) where id=target;
  end if;
 elsif p_action='add_beneficiary' then
  insert into prime_pass.beneficiaries(company_id,first_name,last_name) values(cid,trim(p_data->>'first_name'),trim(p_data->>'last_name'));
 elsif p_action='update_beneficiary' then
  select * into be from prime_pass.beneficiaries where id=(p_data->>'id')::uuid and company_id=cid;
  if be.id is null then raise exception 'Bénéficiaire introuvable'; end if;
  old_data:=to_jsonb(be);
  update prime_pass.beneficiaries set first_name=trim(p_data->>'first_name'),last_name=trim(p_data->>'last_name'),active=(p_data->>'active')::boolean where id=be.id;
  -- A departed beneficiary cannot keep future allocations blocked; preserve all records.
  if not (p_data->>'active')::boolean then update prime_pass.claims set cancelled_at=now() where beneficiary_id=be.id and cancelled_at is null and access_date>=today; end if;
 elsif p_action='claim' then
  d:=(p_data->>'access_date')::date; bid:=(p_data->>'beneficiary_id')::uuid;rid:=(p_data->>'request_id')::uuid;
  if exists(select 1 from prime_pass.claims where request_id=rid and company_id=cid) then return jsonb_build_object('ok',true); end if;
  if d is null or d<today or d>today+14 then raise exception 'Choisissez aujourd’hui ou une date dans les 14 prochains jours'; end if;
  if not exists(select 1 from prime_pass.beneficiaries where id=bid and company_id=cid and active) then raise exception 'Bénéficiaire inactif ou introuvable'; end if;
  select * into ct from prime_pass.contracts where company_id=cid and d between starts_on and ends_on;
  if ct.id is null then raise exception 'Aucun contrat pour cette date'; end if;
  if exists(select 1 from prime_pass.claims where beneficiary_id=bid and access_date=d and cancelled_at is null) then raise exception 'Ce bénéficiaire dispose déjà d’un droit à cette date'; end if;
  select count(*) into n from prime_pass.claims where contract_id=ct.id and access_date=d and cancelled_at is null;
  if n>=ct.daily_rights then raise exception 'Tous les droits sont attribués pour cette date'; end if;
  insert into prime_pass.claims(company_id,contract_id,beneficiary_id,access_date,request_id,actor_id) values(cid,ct.id,bid,d,rid,p_actor);
 elsif p_action='cancel_claim' then
  select * into cl from prime_pass.claims where id=(p_data->>'id')::uuid and company_id=cid;
  if cl.id is null then raise exception 'Attribution introuvable'; end if;
  if cl.cancelled_at is not null then return jsonb_build_object('ok',true); end if;
  old_data:=to_jsonb(cl);
  update prime_pass.claims set cancelled_at=now() where id=cl.id;
 elsif p_action='record_cryo' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  rid:=(p_data->>'request_id')::uuid;bid:=(p_data->>'beneficiary_id')::uuid;d:=(p_data->>'performed_on')::date;
  if exists(select 1 from prime_pass.cryo where request_id=rid and company_id=cid) then return jsonb_build_object('ok',true); end if;
  if d is null or d>today then raise exception 'La séance doit avoir été réalisée'; end if;
  if not exists(select 1 from prime_pass.beneficiaries where id=bid and company_id=cid and active) then raise exception 'Bénéficiaire inactif ou introuvable'; end if;
  select * into ct from prime_pass.contracts where company_id=cid and d between starts_on and ends_on;
  if ct.id is null then raise exception 'Aucun contrat pour cette date'; end if;
  select count(*) into n from prime_pass.cryo where contract_id=ct.id and voided_at is null;
  if n>=ct.cryo_quota then raise exception 'Quota cryo épuisé'; end if;
  insert into prime_pass.cryo(company_id,contract_id,beneficiary_id,performed_on,request_id,actor_id) values(cid,ct.id,bid,d,rid,p_actor);
 elsif p_action='void_cryo' then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  select * into cr from prime_pass.cryo where id=(p_data->>'id')::uuid and company_id=cid;
  if cr.id is null then raise exception 'Séance introuvable'; end if;
  if cr.voided_at is not null then return jsonb_build_object('ok',true); end if;
  old_data:=to_jsonb(cr);
  update prime_pass.cryo set voided_at=now(),void_reason=trim(p_data->>'reason') where id=cr.id;
 else raise exception 'Action inconnue'; end if;
 insert into prime_pass.audit(company_id,actor_id,action,detail) values(cid,p_actor,p_action,jsonb_build_object('input',p_data-'logo','before',old_data-'logo'));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prime_pass_execute(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prime_pass_execute(uuid,text,jsonb) to service_role;
create or replace function public.prime_pass_subscriptions(p_actor uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a prime_pass.accounts; sub prime_pass.subscriptions; item jsonb; records jsonb:='[]'; result jsonb;
 qty integer; total numeric:=0; amt numeric; remaining numeric; ct integer:=0; target uuid; co jsonb;
begin
 if p_action='campaign' then
  return jsonb_build_object('enabled',(select enabled from prime_pass.subscription_campaign where id),'tariffs',jsonb_build_object('company',2690,'additional_right',1690,'individual',1890,'director',1690,'duo',800));
 end if;
 if p_action='submit' then
  if coalesce(p_data->>'discount','standard')<>'standard' then raise exception 'Remise réservée à Prime'; end if;
  if not (select enabled from prime_pass.subscription_campaign where id) then raise exception 'La campagne de souscription est fermée'; end if;
  if p_data->>'consent' is distinct from 'true' or coalesce(p_data->>'website','')<>'' then raise exception 'Demande invalide'; end if;
  target:=(p_data->>'id')::uuid;
  if target is null then raise exception 'Identifiant requis'; end if;
  -- Serialize admission and retries; no public record lookup or privileged account creation.
  perform pg_advisory_xact_lock(713285104);
  select * into sub from prime_pass.subscriptions where id=target;
  if sub.id is not null then return jsonb_build_object('ok',true,'reference',target,'total_amount',sub.total_amount,'tax_basis',sub.tax_basis); end if;
  if (select count(*) from prime_pass.subscriptions where created_at>now()-interval '1 hour' and email=lower(trim(p_data->>'email')))>=5
    or (select count(*) from prime_pass.subscriptions where created_at>now()-interval '1 hour' and ip_hash=p_data->>'ip_hash')>=20
    or (select count(*) from prime_pass.subscriptions where created_at>now()-interval '1 day')>=1000 then raise exception 'Trop de demandes. Réessayez plus tard ou contactez Prime.'; end if;
  qty:=(p_data->>'quantity')::integer;
  if qty is null or qty<1 or qty>150 then raise exception 'Quantité invalide'; end if;
  if p_data->>'offer'='company' then
   total:=2690+(qty-1)*1690;
   if jsonb_array_length(p_data->'participants')<>0 then raise exception 'Demande entreprise invalide'; end if;
  elsif p_data->>'offer' in ('individual','director') then
   if qty>20 or jsonb_typeof(p_data->'participants')<>'array' or jsonb_array_length(p_data->'participants')<>qty then raise exception 'Renseignez chaque adhésion'; end if;
   for item in select value from jsonb_array_elements(p_data->'participants') loop
    if coalesce(length(trim(item->>'first_name')),0) not between 1 and 80 or coalesce(length(trim(item->>'last_name')),0) not between 1 and 80 or jsonb_typeof(item->'duo') is distinct from 'boolean' then raise exception 'Identité du titulaire requise'; end if;
    if (item->>'duo')::boolean and (coalesce(length(trim(item->>'duo_first_name')),0) not between 1 and 80 or coalesce(length(trim(item->>'duo_last_name')),0) not between 1 and 80) then raise exception 'Identité de la personne associée requise'; end if;
    total:=total+case when p_data->>'offer'='director' then 1690 else 1890 end+case when (item->>'duo')::boolean then 800 else 0 end;
   end loop;
  else raise exception 'Offre invalide'; end if;
  if p_data->>'ip_hash' is null then raise exception 'Requête invalide'; end if;
  insert into prime_pass.subscriptions(id,offer,company_name,contact_name,email,phone,quantity,participants,total_amount,tax_basis,ip_hash)
  values(target,p_data->>'offer',left(trim(coalesce(p_data->>'company_name','')),160),trim(p_data->>'contact_name'),lower(trim(p_data->>'email')),trim(p_data->>'phone'),qty,p_data->'participants',total,case when p_data->>'offer'='individual' then 'TTC' else 'HT' end,p_data->>'ip_hash');
  return jsonb_build_object('ok',true,'reference',target,'total_amount',total,'tax_basis',case when p_data->>'offer'='individual' then 'TTC' else 'HT' end);
 end if;
 select * into a from prime_pass.accounts where user_id=p_actor and active and role='prime_admin';
 if a.user_id is null then raise exception 'Action réservée à Prime'; end if;
 if p_action='list' then
  return jsonb_build_object('enabled',(select enabled from prime_pass.subscription_campaign where id),'subscriptions',coalesce((select jsonb_agg(to_jsonb(x)-'ip_hash' order by x.created_at desc) from prime_pass.subscriptions x),'[]'::jsonb));
 end if;
 if p_action='set_campaign' then
  update prime_pass.subscription_campaign set enabled=(p_data->>'enabled')::boolean where id;
  insert into prime_pass.audit(actor_id,action,detail) values(p_actor,'subscription_campaign',p_data);
  return jsonb_build_object('ok',true);
 end if;
 select * into sub from prime_pass.subscriptions where id=(p_data->>'id')::uuid for update;
 if sub.id is null then raise exception 'Souscription introuvable'; end if;
 if p_action='get' then return to_jsonb(sub)-'ip_hash'; end if;
 if sub.status='activated' then return jsonb_build_object('ok',true,'linked_records',sub.linked_records); end if;
 if p_action='decline' then
  update prime_pass.subscriptions set status='declined' where id=sub.id;
 elsif p_action='activate' then
  if sub.status<>'pending' then raise exception 'Cette demande est classée sans suite'; end if;
  if (p_data->>'starts_on')::date is null or (p_data->>'ends_on')::date is null then raise exception 'Période requise'; end if;
  amt:=(p_data->>'paid_amount')::numeric;
  if amt is null or amt<0 or amt>=1000000000 then raise exception 'Prix payé invalide'; end if;
  if sub.offer='company' then
   co:=public.prime_pass_execute(p_actor,'create_company',jsonb_build_object('request_id',sub.id,'auth_user_id',p_data->>'auth_user_id','name',sub.company_name,'contact_name',sub.contact_name,'email',sub.email,'phone',sub.phone,'daily_rights',sub.quantity,'starts_on',p_data->>'starts_on','ends_on',p_data->>'ends_on','paid_amount',amt,'discount',coalesce(p_data->>'discount','standard')));
   records:=jsonb_build_array(jsonb_build_object('company_id',co->>'id'));
  else
   remaining:=amt;
   for item in select value from jsonb_array_elements(sub.participants) loop
    ct:=ct+1; target:=gen_random_uuid();
    total:=case when ct=sub.quantity then remaining else trunc(amt*(case when sub.offer='director' then 1690 else 1890 end+case when (item->>'duo')::boolean then 800 else 0 end)/sub.total_amount,2) end;
    remaining:=remaining-total;
    perform public.prime_pass_execute(p_actor,'save_vip',item||jsonb_build_object('id',target,'email',sub.email,'phone',sub.phone,'profile',sub.offer,'active',true,'starts_on',p_data->>'starts_on','ends_on',p_data->>'ends_on','paid_amount',total,'discount',coalesce(p_data->>'discount','standard')));
    records:=records||jsonb_build_array(jsonb_build_object('vip_id',target));
   end loop;
  end if;
  update prime_pass.subscriptions set status='activated',linked_records=records,discount=coalesce(p_data->>'discount','standard') where id=sub.id;
 else raise exception 'Action invalide'; end if;
 insert into prime_pass.audit(actor_id,action,detail) values(p_actor,'subscription_'||p_action,jsonb_build_object('id',sub.id,'input',p_data-'auth_user_id'));
 return jsonb_build_object('ok',true,'linked_records',records);
end $$;
revoke all on function public.prime_pass_subscriptions(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prime_pass_subscriptions(uuid,text,jsonb) to service_role;
commit;
