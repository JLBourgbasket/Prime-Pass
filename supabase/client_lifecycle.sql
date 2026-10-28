begin;
alter table prime_pass.contracts add column retired_at timestamptz;
create table prime_pass.auth_cleanup(user_id uuid primary key,created_at timestamptz not null default now());
alter table prime_pass.auth_cleanup enable row level security;
revoke all on prime_pass.auth_cleanup from public,anon,authenticated;
grant all on prime_pass.auth_cleanup to service_role;
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
  if old_data->>'active'='false' and (p_data->>'active')::boolean then raise exception 'Réactivez cette fiche depuis Clients désactivés avec un nouveau contrat'; end if;
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
  if not co.active and (p_data->>'active')::boolean then raise exception 'Réactivez cette fiche depuis Clients désactivés avec un nouveau contrat'; end if;
  old_data:=to_jsonb(co);
  update prime_pass.companies set name=trim(p_data->>'name'),contact_name=trim(p_data->>'contact_name'),phone=trim(p_data->>'phone'),logo=nullif(p_data->>'logo',''),active=(p_data->>'active')::boolean where id=cid;
  if not (p_data->>'active')::boolean then
   update prime_pass.claims set cancelled_at=now() where company_id=cid and cancelled_at is null and access_date>=today;
   update prime_pass.contracts set retired_at=coalesce(retired_at,now()) where company_id=cid;
   update prime_pass.accounts set active=false where company_id=cid;
  end if;
 elsif p_action in ('add_contract','update_contract') then
  if a.role<>'prime_admin' then raise exception 'Action réservée à Prime'; end if;
  target:=nullif(p_data->>'id','')::uuid;
  if exists(select 1 from prime_pass.contracts where company_id=cid and retired_at is null and (target is null or id<>target) and starts_on<=(p_data->>'ends_on')::date and ends_on>=(p_data->>'starts_on')::date) then raise exception 'Les périodes de contrat ne peuvent pas se chevaucher'; end if;
  if p_action='add_contract' then
   insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights,paid_amount,discount) values(cid,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer,nullif(p_data->>'paid_amount','')::numeric,coalesce(p_data->>'discount','standard'));
  else
   select * into ct from prime_pass.contracts where id=target and company_id=cid;
   if ct.id is null then raise exception 'Contrat introuvable'; end if;
   if ct.retired_at is not null then raise exception 'Contrat clôturé'; end if;
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
  select * into ct from prime_pass.contracts where company_id=cid and retired_at is null and d between starts_on and ends_on;
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
  select * into ct from prime_pass.contracts where company_id=cid and retired_at is null and d between starts_on and ends_on;
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
create or replace function public.prime_pass_lifecycle(p_actor uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare co prime_pass.companies; v prime_pass.vips; cid uuid; uid uuid; before_data jsonb; ids jsonb; sub prime_pass.subscriptions; idx integer;
begin
 if not exists(select 1 from prime_pass.accounts where user_id=p_actor and active and role='prime_admin') then raise exception 'Action réservée à Prime'; end if;
 if p_action='cleanup_list' then return coalesce((select jsonb_agg(user_id) from (select user_id from prime_pass.auth_cleanup order by created_at limit 10) x),'[]'::jsonb); end if;
 if p_action='cleanup_done' then delete from prime_pass.auth_cleanup where user_id=(p_data->>'user_id')::uuid; return jsonb_build_object('ok',true); end if;
 if p_action not in ('archive_company','archive_vip','restore_company','restore_vip','purge_company','purge_vip') then raise exception 'Action invalide'; end if;
 cid:=(p_data->>'id')::uuid;
 if p_action like '%_company' then
  select * into co from prime_pass.companies where id=cid for update;
  if co.id is null then raise exception 'Entreprise introuvable'; end if;
  before_data:=to_jsonb(co)-'logo';
  if p_action='archive_company' then
   update prime_pass.claims set cancelled_at=now() where company_id=cid and cancelled_at is null and access_date>=(now() at time zone 'Europe/Paris')::date;
   update prime_pass.contracts set retired_at=coalesce(retired_at,now()) where company_id=cid;
   update prime_pass.accounts set active=false where company_id=cid;
   update prime_pass.companies set active=false where id=cid;
  elsif p_action='restore_company' then
   if co.active then raise exception 'Cette entreprise est déjà active'; end if;
   -- Older suspended accounts also need a fresh quota: never reactivate an old contract.
   update prime_pass.claims set cancelled_at=now() where company_id=cid and cancelled_at is null and access_date>=(now() at time zone 'Europe/Paris')::date;
   update prime_pass.contracts set retired_at=coalesce(retired_at,now()) where company_id=cid;
   insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights,paid_amount,discount)
   values(cid,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer,(p_data->>'paid_amount')::numeric,coalesce(p_data->>'discount','standard'));
   update prime_pass.companies set active=true where id=cid;
   update prime_pass.accounts set active=true where company_id=cid;
  else
   if co.active then raise exception 'Désactivez la fiche avant sa suppression définitive'; end if;
   if p_data->>'confirmation' is distinct from co.name then raise exception 'Saisissez le nom exact du client pour confirmer'; end if;
   insert into prime_pass.auth_cleanup(user_id) select user_id from prime_pass.accounts where company_id=cid on conflict do nothing;
   select coalesce(jsonb_agg(user_id),'[]'::jsonb) into ids from prime_pass.accounts where company_id=cid;
   delete from prime_pass.subscriptions where id=co.request_id or linked_records @> jsonb_build_array(jsonb_build_object('company_id',cid::text));
   delete from prime_pass.claims where company_id=cid;
   delete from prime_pass.cryo where company_id=cid;
   delete from prime_pass.beneficiaries where company_id=cid;
   delete from prime_pass.contracts where company_id=cid;
   delete from prime_pass.audit where company_id=cid or actor_id in(select user_id from prime_pass.accounts where company_id=cid);
   delete from prime_pass.accounts where company_id=cid;
   delete from public.prime_pass_updates where company_id=cid;
   delete from prime_pass.companies where id=cid;
   insert into prime_pass.audit(actor_id,action,detail) values(p_actor,p_action,jsonb_build_object('deleted_id',cid));
   return jsonb_build_object('ok',true,'auth_users',ids);
  end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(cid::text,0));
  select * into v from prime_pass.vips where id=cid for update;
  if v.id is null then raise exception 'VIP introuvable'; end if;
  before_data:=to_jsonb(v);
  if p_action='archive_vip' then update prime_pass.vips set active=false where id=cid;
  elsif p_action='restore_vip' then
   if v.active then raise exception 'Ce VIP est déjà actif'; end if;
   update prime_pass.vips set active=true,starts_on=(p_data->>'starts_on')::date,ends_on=(p_data->>'ends_on')::date,
    profile=p_data->>'profile',duo=(p_data->>'duo')::boolean,
    duo_first_name=case when (p_data->>'duo')::boolean then trim(p_data->>'duo_first_name') end,
    duo_last_name=case when (p_data->>'duo')::boolean then trim(p_data->>'duo_last_name') end,
    paid_amount=(p_data->>'paid_amount')::numeric,discount=coalesce(p_data->>'discount','standard') where id=cid;
  else
   if v.active then raise exception 'Désactivez la fiche avant sa suppression définitive'; end if;
   if p_data->>'confirmation' is distinct from trim(v.first_name||' '||v.last_name) then raise exception 'Saisissez le nom exact du client pour confirmer'; end if;
   for sub in select * from prime_pass.subscriptions where linked_records @> jsonb_build_array(jsonb_build_object('vip_id',cid::text)) for update loop
    if jsonb_array_length(sub.linked_records)=1 then delete from prime_pass.subscriptions where id=sub.id;
    else
     select ordinality::integer-1 into idx from jsonb_array_elements(sub.linked_records) with ordinality where value->>'vip_id'=cid::text;
     update prime_pass.subscriptions set participants=jsonb_set(participants,array[idx::text],'{"first_name":"Client","last_name":"supprimé","duo":false}'::jsonb),linked_records=jsonb_set(linked_records,array[idx::text],'{"deleted":true}'::jsonb) where id=sub.id;
    end if;
   end loop;
   delete from prime_pass.audit where detail->'before'->>'id'=cid::text or detail->'after'->>'id'=cid::text or detail->>'client_id'=cid::text;
   delete from prime_pass.vips where id=cid;
   insert into prime_pass.audit(actor_id,action,detail) values(p_actor,p_action,jsonb_build_object('deleted_id',cid));
   return jsonb_build_object('ok',true);
  end if;
 end if;
 insert into prime_pass.audit(company_id,actor_id,action,detail) values(case when p_action like '%_company' then cid end,p_actor,p_action,jsonb_build_object('client_id',cid,'before',before_data,'input',p_data));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prime_pass_lifecycle(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prime_pass_lifecycle(uuid,text,jsonb) to service_role;
commit;
