-- One-time setup for the existing FUP administrator. Only fup-sep is changed.
create table if not exists "fup-sep".v4_admin_activation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table "fup-sep".v4_admin_activation enable row level security;
revoke all on "fup-sep".v4_admin_activation from public, anon, authenticated;
grant select, insert, update on "fup-sep".v4_admin_activation to service_role;

create or replace function "fup-sep".v4_issue_admin_activation()
returns text language plpgsql security definer set search_path = ''
as $$
declare v_token text; v_user_id uuid;
begin
  if current_user <> 'postgres' then raise exception 'Acceso denegado'; end if;
  select id into v_user_id from auth.users where lower(email) = 'nomina@fup.com';
  if v_user_id is null then raise exception 'Cuenta administradora inexistente'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into "fup-sep".v4_admin_activation(user_id, token_hash, expires_at, used_at)
  values (v_user_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '24 hours', null)
  on conflict (user_id) do update set token_hash = excluded.token_hash,
    expires_at = excluded.expires_at, used_at = null;
  return v_token;
end;
$$;

create or replace function "fup-sep".v4_consume_admin_activation(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Acceso denegado'; end if;
  update "fup-sep".v4_admin_activation
     set used_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and expires_at > now() and used_at is null
   returning user_id into v_user_id;
  return v_user_id;
end;
$$;

revoke all on function "fup-sep".v4_issue_admin_activation() from public, anon, authenticated, service_role;
revoke all on function "fup-sep".v4_consume_admin_activation(text) from public, anon, authenticated;
grant execute on function "fup-sep".v4_consume_admin_activation(text) to service_role;
notify pgrst, 'reload schema';
