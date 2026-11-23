begin;
create table if not exists "fup-sep".v10_device_pairs (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists v10_device_pairs_user_idx on "fup-sep".v10_device_pairs(user_id);
alter table "fup-sep".v10_device_pairs enable row level security;

create or replace function "fup-sep".v10_issue_device_pair()
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if auth.uid() is null or not exists (
    select 1 from "fup-sep".v3_accounts where user_id = auth.uid() and role = 'operador'
  ) then raise exception 'Solo un operador con sesión puede abrir su QR'; end if;
  delete from "fup-sep".v10_device_pairs where user_id = auth.uid() or expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into "fup-sep".v10_device_pairs(token_hash,user_id,expires_at)
  values (encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid(),now() + interval '2 minutes');
  return v_token;
end;
$$;

create or replace function "fup-sep".v10_consume_device_pair(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid;
begin
  if auth.role() <> 'service_role' or coalesce(p_token,'') !~ '^[0-9a-f]{64}$'
    then raise exception 'Código QR inválido'; end if;
  update "fup-sep".v10_device_pairs set used_at = now()
  where token_hash = encode(extensions.digest(p_token,'sha256'),'hex')
    and used_at is null and expires_at > now()
  returning user_id into v_user_id;
  return v_user_id;
end;
$$;

revoke all on "fup-sep".v10_device_pairs from public, anon, authenticated;
revoke all on function "fup-sep".v10_issue_device_pair() from public, anon;
revoke all on function "fup-sep".v10_consume_device_pair(text) from public, anon, authenticated;
grant execute on function "fup-sep".v10_issue_device_pair() to authenticated;
grant execute on function "fup-sep".v10_consume_device_pair(text) to service_role;
commit;
notify pgrst, 'reload schema';
