-- PRIME PASS - initial data model and atomic daily access allocation
create extension if not exists pgcrypto;

create type public.app_role as enum ('member', 'company_admin', 'prime_admin');
create type public.claim_status as enum ('active', 'cancelled');
create type public.booking_status as enum ('confirmed', 'cancelled', 'completed', 'no_show');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  avatar_url text,
  bracelet_reference text unique,
  role public.app_role not null default 'member',
  onboarding_completed_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.company_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  daily_access_limit integer not null check (daily_access_limit > 0),
  cryo_annual_quota integer not null default 0 check (cryo_annual_quota >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create unique index one_active_contract_per_company
  on public.company_contracts(company_id) where active;

create table public.daily_access_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_date date not null default current_date,
  status public.claim_status not null default 'active',
  claimed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  source text not null default 'app' check (source in ('app', 'admin', 'booking'))
);

create unique index one_active_claim_per_user_day
  on public.daily_access_claims(user_id, access_date) where status = 'active';
create index daily_claim_company_date_idx
  on public.daily_access_claims(company_id, access_date) where status = 'active';

create table public.well_services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  capacity integer not null default 1 check (capacity > 0),
  consumes_daily_access boolean not null default true,
  consumes_cryo_credit boolean not null default false,
  active boolean not null default true
);

create table public.well_bookings (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.well_services(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  standalone_visit boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.cryo_ledger (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  booking_id uuid references public.well_bookings(id) on delete set null,
  quantity integer not null check (quantity <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.well_services(slug, name, duration_minutes, capacity, consumes_daily_access, consumes_cryo_credit) values
  ('cryo', 'Cryothérapie', 15, 1, false, true),
  ('hydro', 'Hydromassage', 20, 1, true, false),
  ('photo', 'Photobiomodulation', 20, 1, true, false),
  ('presso', 'Pressothérapie', 30, 2, true, false);

create or replace function public.claim_daily_access(p_access_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_id uuid;
  v_limit integer;
  v_used integer;
  v_claim_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select p.company_id into v_company_id
  from public.profiles p
  where p.user_id = v_user_id and p.active and p.onboarding_completed_at is not null;

  if v_company_id is null then
    return jsonb_build_object('granted', false, 'remaining', 0, 'reason', 'Profil inactif ou onboarding incomplet');
  end if;

  -- Locking the active contract serializes simultaneous claims for the company.
  select c.daily_access_limit into v_limit
  from public.company_contracts c
  where c.company_id = v_company_id
    and c.active
    and p_access_date between c.starts_on and c.ends_on
  for update;

  if v_limit is null then
    return jsonb_build_object('granted', false, 'remaining', 0, 'reason', 'Aucun contrat actif');
  end if;

  select count(*)::integer into v_used
  from public.daily_access_claims d
  where d.company_id = v_company_id and d.access_date = p_access_date and d.status = 'active';

  select d.id into v_claim_id
  from public.daily_access_claims d
  where d.user_id = v_user_id and d.access_date = p_access_date and d.status = 'active';

  if v_claim_id is not null then
    return jsonb_build_object('granted', true, 'remaining', greatest(v_limit - v_used, 0), 'claim_id', v_claim_id, 'already_claimed', true);
  end if;

  if v_used >= v_limit then
    return jsonb_build_object('granted', false, 'remaining', 0, 'reason', 'Tous les accès de l’entreprise sont déjà attribués');
  end if;

  insert into public.daily_access_claims(company_id, user_id, access_date)
  values (v_company_id, v_user_id, p_access_date)
  returning id into v_claim_id;

  insert into public.audit_logs(actor_id, company_id, action, metadata)
  values (v_user_id, v_company_id, 'daily_access_claimed', jsonb_build_object('claim_id', v_claim_id, 'access_date', p_access_date));

  return jsonb_build_object('granted', true, 'remaining', v_limit - v_used - 1, 'claim_id', v_claim_id);
end;
$$;

revoke all on function public.claim_daily_access(date) from public;
grant execute on function public.claim_daily_access(date) to authenticated;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_contracts enable row level security;
alter table public.daily_access_claims enable row level security;
alter table public.well_services enable row level security;
alter table public.well_bookings enable row level security;
alter table public.cryo_ledger enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.user_id = auth.uid() and p.active;
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.company_id from public.profiles p where p.user_id = auth.uid() and p.active;
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_company_id() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_company_id() to authenticated;

create policy "users read own profile" on public.profiles for select to authenticated using (user_id = auth.uid());
create policy "users read own claims" on public.daily_access_claims for select to authenticated using (user_id = auth.uid());
create policy "users read services" on public.well_services for select to authenticated using (active);
create policy "users manage own bookings" on public.well_bookings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read own company" on public.companies for select to authenticated
  using (id = public.current_company_id() or public.current_user_role() = 'prime_admin');
create policy "company admins read company profiles" on public.profiles for select to authenticated
  using (public.current_user_role() = 'prime_admin' or (public.current_user_role() = 'company_admin' and company_id = public.current_company_id()));
create policy "company admins read company claims" on public.daily_access_claims for select to authenticated
  using (public.current_user_role() = 'prime_admin' or (public.current_user_role() = 'company_admin' and company_id = public.current_company_id()));
create policy "company admins read contract" on public.company_contracts for select to authenticated
  using (public.current_user_role() = 'prime_admin' or (public.current_user_role() = 'company_admin' and company_id = public.current_company_id()));
create policy "users read relevant cryo ledger" on public.cryo_ledger for select to authenticated
  using (user_id = auth.uid() or public.current_user_role() = 'prime_admin' or (public.current_user_role() = 'company_admin' and company_id = public.current_company_id()));
create policy "prime admins read audit logs" on public.audit_logs for select to authenticated
  using (public.current_user_role() = 'prime_admin');

-- Service-role operations should create users and administer contracts through protected server functions.
