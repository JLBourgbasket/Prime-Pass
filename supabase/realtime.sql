begin;
-- Realtime carries only a company identifier and a revision, never names or usage details.
create table public.prime_pass_updates (
 company_id uuid primary key references prime_pass.companies(id),
 revision bigint not null default 1
);
alter table public.prime_pass_updates enable row level security;
revoke all on public.prime_pass_updates from public,anon,authenticated;
grant select on public.prime_pass_updates to authenticated;
grant all on public.prime_pass_updates to service_role;

create function prime_pass.can_see_company(p_company uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from prime_pass.accounts a where a.user_id=auth.uid() and a.active and
  (a.role='prime_admin' or (a.company_id=p_company and exists(select 1 from prime_pass.companies c where c.id=p_company and c.active))));
$$;
revoke all on function prime_pass.can_see_company(uuid) from public,anon;
grant usage on schema prime_pass to authenticated;
grant execute on function prime_pass.can_see_company(uuid) to authenticated;
create policy company_updates_read on public.prime_pass_updates for select to authenticated using(prime_pass.can_see_company(company_id));

create function prime_pass.notify_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare cid uuid;
begin
 if tg_table_name='companies' then cid:=new.id; else cid:=new.company_id; end if;
 if cid is not null then
  insert into public.prime_pass_updates(company_id) values(cid)
  on conflict(company_id) do update set revision=public.prime_pass_updates.revision+1;
 end if;
 return new;
end $$;
revoke all on function prime_pass.notify_change() from public,anon,authenticated;
grant execute on function prime_pass.notify_change() to service_role;
create trigger notify_company after insert or update on prime_pass.companies for each row execute function prime_pass.notify_change();
create trigger notify_contract after insert or update on prime_pass.contracts for each row execute function prime_pass.notify_change();
create trigger notify_beneficiary after insert or update on prime_pass.beneficiaries for each row execute function prime_pass.notify_change();
create trigger notify_claim after insert or update on prime_pass.claims for each row execute function prime_pass.notify_change();
create trigger notify_cryo after insert or update on prime_pass.cryo for each row execute function prime_pass.notify_change();
create trigger notify_account after insert or update on prime_pass.accounts for each row execute function prime_pass.notify_change();
insert into public.prime_pass_updates(company_id) select id from prime_pass.companies;
alter publication supabase_realtime add table public.prime_pass_updates;
commit;
