-- PRIME PASS ENTREPRISE v2. Additive installation: keeps legacy tables untouched.
-- Execute once in the intended project's SQL editor; see README for bootstrap.
begin;
create schema if not exists prime_pass;
revoke all on schema prime_pass from public, anon, authenticated;
grant usage on schema prime_pass to service_role;

create table prime_pass.companies (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
 contact_name text not null check(length(trim(contact_name)) between 1 and 160),
 email text not null unique check(length(email)<=254 and email like '%@%'), phone text not null check(length(trim(phone)) between 1 and 40),
 logo text check(logo is null or (length(logo)<400000 and logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$')),
 active boolean not null default true, request_id uuid not null unique, created_at timestamptz not null default now()
);
create table prime_pass.accounts (
 user_id uuid primary key references auth.users(id), role text not null check(role in ('prime_admin','company')),
 company_id uuid references prime_pass.companies(id), active boolean not null default true,
 check ((role='prime_admin' and company_id is null) or (role='company' and company_id is not null))
);
create table prime_pass.contracts (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references prime_pass.companies(id),
 starts_on date not null, ends_on date not null, daily_rights integer not null check(daily_rights between 1 and 150),
 cryo_quota integer generated always as (daily_rights*20) stored, check(ends_on>=starts_on),
 created_at timestamptz not null default now()
);
create index contracts_company on prime_pass.contracts(company_id,starts_on,ends_on);
create table prime_pass.beneficiaries (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references prime_pass.companies(id),
 first_name text not null check(length(trim(first_name)) between 1 and 80), last_name text not null check(length(trim(last_name)) between 1 and 80),
 active boolean not null default true, created_at timestamptz not null default now()
);
create table prime_pass.claims (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references prime_pass.companies(id),
 contract_id uuid not null references prime_pass.contracts(id), beneficiary_id uuid not null references prime_pass.beneficiaries(id),
 access_date date not null, created_at timestamptz not null default now(), cancelled_at timestamptz,
 request_id uuid not null unique, actor_id uuid not null references auth.users(id)
);
create unique index claim_person_day on prime_pass.claims(beneficiary_id,access_date) where cancelled_at is null;
create index claims_capacity on prime_pass.claims(contract_id,access_date) where cancelled_at is null;
create table prime_pass.cryo (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references prime_pass.companies(id),
 contract_id uuid not null references prime_pass.contracts(id), beneficiary_id uuid not null references prime_pass.beneficiaries(id),
 performed_on date not null, created_at timestamptz not null default now(), actor_id uuid not null references auth.users(id),
 request_id uuid not null unique, voided_at timestamptz, void_reason text,
 check(voided_at is null or (void_reason is not null and length(trim(void_reason)) between 1 and 500))
);
create index cryo_contract on prime_pass.cryo(contract_id) where voided_at is null;
create table prime_pass.audit (
 id bigint generated always as identity primary key, company_id uuid references prime_pass.companies(id),
 actor_id uuid not null references auth.users(id), action text not null, detail jsonb not null, created_at timestamptz not null default now()
);
alter table prime_pass.companies enable row level security;
alter table prime_pass.accounts enable row level security;
alter table prime_pass.contracts enable row level security;
alter table prime_pass.beneficiaries enable row level security;
alter table prime_pass.claims enable row level security;
alter table prime_pass.cryo enable row level security;
alter table prime_pass.audit enable row level security;
-- No direct browser access. Only the Netlify backend validates JWTs and calls this RPC.
revoke all on all tables in schema prime_pass from public, anon, authenticated;
grant all on all tables in schema prime_pass to service_role;
grant usage,select on all sequences in schema prime_pass to service_role;

create or replace function public.prime_pass_execute(p_actor uuid, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 a prime_pass.accounts; co prime_pass.companies; ct prime_pass.contracts; be prime_pass.beneficiaries;
 cl prime_pass.claims; cr prime_pass.cryo; cid uuid; bid uuid; rid uuid; target uuid; d date;
 today date := (now() at time zone 'Europe/Paris')::date; n integer; result jsonb; old_data jsonb;
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
   'audit',coalesce((select jsonb_agg(x order by x.id desc) from (select * from prime_pass.audit where a.role='prime_admin' order by id desc limit 300) x),'[]'::jsonb)
  ) into result;
  return result;
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
  insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights) values(co.id,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer);
  insert into prime_pass.audit(company_id,actor_id,action,detail) values(co.id,p_actor,p_action,jsonb_build_object('name',co.name));
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
   insert into prime_pass.contracts(company_id,starts_on,ends_on,daily_rights) values(cid,(p_data->>'starts_on')::date,(p_data->>'ends_on')::date,(p_data->>'daily_rights')::integer);
  else
   select * into ct from prime_pass.contracts where id=target and company_id=cid;
   if ct.id is null then raise exception 'Contrat introuvable'; end if;
   old_data:=to_jsonb(ct);
   if exists(select 1 from prime_pass.claims where contract_id=target and cancelled_at is null group by access_date having count(*)>(p_data->>'daily_rights')::integer)
    or (select count(*) from prime_pass.cryo where contract_id=target and voided_at is null)>(p_data->>'daily_rights')::integer*20 then raise exception 'Les droits ne peuvent pas être inférieurs aux utilisations enregistrées'; end if;
   if exists(select 1 from prime_pass.claims where contract_id=target and cancelled_at is null and access_date not between (p_data->>'starts_on')::date and (p_data->>'ends_on')::date)
    or exists(select 1 from prime_pass.cryo where contract_id=target and voided_at is null and performed_on not between (p_data->>'starts_on')::date and (p_data->>'ends_on')::date) then raise exception 'La période doit couvrir les utilisations enregistrées'; end if;
   update prime_pass.contracts set starts_on=(p_data->>'starts_on')::date, ends_on=(p_data->>'ends_on')::date,daily_rights=(p_data->>'daily_rights')::integer where id=target;
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
commit;
