-- Human-readable usernames and safe account removal. Only fup-sep is changed.
begin;

alter table "fup-sep".v3_accounts drop constraint if exists v3_accounts_username_check;
alter table "fup-sep".v3_accounts add constraint v3_accounts_username_check
  check (username ~ '^[a-záéíóúüñ][a-z0-9áéíóúüñ._ -]{2,79}$');

create or replace function "fup-sep".v8_keep_last_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'administrador' then
    perform pg_catalog.pg_advisory_xact_lock(2026, 7);
    if (select count(*) from "fup-sep".v3_accounts where role = 'administrador') <= 1 then
      raise exception 'Debe quedar al menos una cuenta administradora';
    end if;
  end if;
  return old;
end;
$$;
drop trigger if exists v8_keep_last_admin on "fup-sep".v3_accounts;
create trigger v8_keep_last_admin before delete on "fup-sep".v3_accounts
for each row execute function "fup-sep".v8_keep_last_admin();

create or replace function "fup-sep".v8_transfer_batches(p_from uuid, p_to uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Acceso denegado'; end if;
  if p_from = p_to or not exists (
    select 1 from "fup-sep".v3_accounts where user_id = p_to and role = 'administrador'
  ) then raise exception 'Administrador de destino inválido'; end if;
  update "fup-sep".v2_batches set admin_id = p_to where admin_id = p_from;
end;
$$;

revoke all on function "fup-sep".v8_keep_last_admin() from public, anon, authenticated;
revoke all on function "fup-sep".v8_transfer_batches(uuid, uuid) from public, anon, authenticated;
grant execute on function "fup-sep".v8_transfer_batches(uuid, uuid) to service_role;
commit;
notify pgrst, 'reload schema';
