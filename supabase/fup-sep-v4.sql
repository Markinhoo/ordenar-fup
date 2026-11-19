-- Account directory and rate-limited recovery for Ordenar FUP.
-- Only the "fup-sep" schema is changed; Auth users remain managed by Auth API.
create table if not exists "fup-sep".v3_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  recovery_question text,
  recovery_salt text,
  recovery_hash text,
  recovery_attempts integer not null default 0,
  recovery_locked_until timestamptz,
  created_at timestamptz not null default now()
);
alter table "fup-sep".v3_accounts enable row level security;
revoke all on "fup-sep".v3_accounts from public, anon, authenticated;
grant usage on schema "fup-sep" to service_role;
grant select, insert, update on "fup-sep".v3_accounts to service_role;

insert into "fup-sep".v3_accounts(user_id, email, name)
select distinct on (w.user_id) w.user_id, lower(w.email), w.name
from "fup-sep".v2_workers w where w.user_id is not null
order by w.user_id, w.sort_order
on conflict do nothing;
insert into "fup-sep".v3_accounts(user_id, email, name)
select u.id, lower(u.email), 'Administrador'
from auth.users u where lower(u.email) = 'nomina@fup.com'
on conflict do nothing;

create or replace function "fup-sep".v3_take_recovery_attempt(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_account "fup-sep".v3_accounts%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Acceso denegado'; end if;
  select * into v_account from "fup-sep".v3_accounts
  where email = lower(trim(coalesce(p_email, ''))) for update;
  if not found or v_account.recovery_hash is null then return null; end if;
  if v_account.recovery_locked_until > now() then return jsonb_build_object('locked', true); end if;
  if v_account.recovery_locked_until is not null then
    update "fup-sep".v3_accounts set recovery_attempts = 0, recovery_locked_until = null
    where user_id = v_account.user_id;
    v_account.recovery_attempts := 0;
  end if;
  if v_account.recovery_attempts >= 5 then
    update "fup-sep".v3_accounts set recovery_locked_until = now() + interval '30 minutes'
    where user_id = v_account.user_id;
    return jsonb_build_object('locked', true);
  end if;
  update "fup-sep".v3_accounts set recovery_attempts = v_account.recovery_attempts + 1
  where user_id = v_account.user_id;
  return jsonb_build_object('userId', v_account.user_id, 'salt', v_account.recovery_salt,
    'hash', v_account.recovery_hash);
end;
$$;

create or replace function "fup-sep".v3_clear_recovery_attempts(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Acceso denegado'; end if;
  update "fup-sep".v3_accounts set recovery_attempts = 0, recovery_locked_until = null
  where user_id = p_user_id;
end;
$$;

create or replace function "fup-sep".v2_claim_worker(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_worker "fup-sep".v2_workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if not exists (select 1 from "fup-sep".v3_accounts where user_id = auth.uid()) then
    raise exception 'La encargada debe crear tu cuenta antes de usar el QR';
  end if;
  select * into v_worker from "fup-sep".v2_workers where token = p_token;
  if not found then raise exception 'QR de acceso inválido'; end if;
  if lower(coalesce(auth.jwt()->>'email', '')) <> v_worker.email then
    raise exception 'Este QR corresponde a otro correo';
  end if;
  if v_worker.user_id is not null and v_worker.user_id <> auth.uid() then
    raise exception 'Este puesto ya pertenece a otra cuenta';
  end if;
  update "fup-sep".v2_workers set user_id = auth.uid() where id = v_worker.id;
  return jsonb_build_object('batchId', v_worker.batch_id, 'workerId', v_worker.id, 'name', v_worker.name);
end;
$$;

revoke all on function "fup-sep".v3_take_recovery_attempt(text) from public, anon, authenticated;
revoke all on function "fup-sep".v3_clear_recovery_attempts(uuid) from public, anon, authenticated;
grant execute on function "fup-sep".v3_take_recovery_attempt(text) to service_role;
grant execute on function "fup-sep".v3_clear_recovery_attempts(uuid) to service_role;
notify pgrst, 'reload schema';
