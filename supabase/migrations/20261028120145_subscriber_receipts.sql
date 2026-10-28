begin;
alter table prime_pass.subscriptions
 add column receipt_status text not null default 'pending' check(receipt_status in ('pending','sending','sent','failed')),
 add column receipt_attempts integer not null default 0,
 add column receipt_attempted_at timestamptz,
 add column receipt_sent_at timestamptz,
 add column receipt_error text,
 add column receipt_token uuid;
create or replace function public.prime_pass_receipt(p_actor uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare sub prime_pass.subscriptions; token uuid;
begin
 if p_action not in ('claim','finish') then raise exception 'Action invalide'; end if;
 if coalesce((p_data->>'retry')::boolean,false) then
  if not exists(select 1 from prime_pass.accounts where user_id=p_actor and active and role='prime_admin') then raise exception 'Action réservée à Prime'; end if;
 end if;
 select * into sub from prime_pass.subscriptions where id=(p_data->>'id')::uuid for update;
 if sub.id is null then raise exception 'Souscription introuvable'; end if;
 if p_action='claim' then
  if sub.receipt_status='sent' then return null; end if;
  if sub.receipt_attempts>0 and not coalesce((p_data->>'retry')::boolean,false) then return null; end if;
  if sub.receipt_attempted_at>now()-interval '1 minute' or (sub.receipt_status='sending' and sub.receipt_attempted_at>now()-interval '5 minutes') then return null; end if;
  token:=gen_random_uuid();
  update prime_pass.subscriptions set receipt_status='sending',receipt_token=token,receipt_attempts=receipt_attempts+1,receipt_attempted_at=now(),receipt_error=null where id=sub.id;
  return jsonb_build_object('token',token,'subscription',to_jsonb(sub)-'ip_hash'-'receipt_token');
 end if;
 if sub.receipt_token is distinct from (p_data->>'token')::uuid or sub.receipt_token is null then raise exception 'Tentative expirée'; end if;
 update prime_pass.subscriptions set receipt_status=case when (p_data->>'sent')::boolean then 'sent' else 'failed' end,
 receipt_sent_at=case when (p_data->>'sent')::boolean then now() else null end,
 receipt_error=case when (p_data->>'sent')::boolean then null else case when p_data->>'error' in ('smtp_config','smtp_auth','smtp_connection','smtp_rejected') then p_data->>'error' else 'smtp_failed' end end,
 receipt_token=null where id=sub.id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prime_pass_receipt(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.prime_pass_receipt(uuid,text,jsonb) to service_role;
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
  return jsonb_build_object('enabled',(select enabled from prime_pass.subscription_campaign where id),'subscriptions',coalesce((select jsonb_agg(to_jsonb(x)-'ip_hash'-'notification_token'-'receipt_token' order by x.created_at desc) from prime_pass.subscriptions x),'[]'::jsonb));
 end if;
 if p_action='set_campaign' then
  update prime_pass.subscription_campaign set enabled=(p_data->>'enabled')::boolean where id;
  insert into prime_pass.audit(actor_id,action,detail) values(p_actor,'subscription_campaign',p_data);
  return jsonb_build_object('ok',true);
 end if;
 select * into sub from prime_pass.subscriptions where id=(p_data->>'id')::uuid for update;
 if sub.id is null then raise exception 'Souscription introuvable'; end if;
 if p_action='get' then return to_jsonb(sub)-'ip_hash'-'notification_token'-'receipt_token'; end if;
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
