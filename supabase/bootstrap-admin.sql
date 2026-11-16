-- Run only after choosing the first Prime administrator and confirming their Auth email.
-- Replace the placeholder explicitly. This does not create or email an Auth user.
do $$
declare
 v_email text := 'REMPLACER_PAR_ADRESSE_ADMIN';
 v_id uuid;
begin
 if v_email='REMPLACER_PAR_ADRESSE_ADMIN' then raise exception 'Renseignez explicitement l’adresse de l’administrateur Prime'; end if;
 select id into v_id from auth.users where lower(email)=lower(v_email) and email_confirmed_at is not null;
 if v_id is null then raise exception 'Créez et confirmez d’abord ce compte dans Supabase Auth'; end if;
 insert into prime_pass.accounts(user_id,role,company_id,active) values(v_id,'prime_admin',null,true)
 on conflict(user_id) do update set role='prime_admin',company_id=null,active=true;
end $$;
