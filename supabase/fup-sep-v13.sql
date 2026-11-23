-- The old event trigger still rejected administrators after v12 allowed their scans.
-- Preserve the existing requirement that the actor use an active FUP account.
begin;
create or replace function "fup-sep".v7_enforce_operator_scan()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from "fup-sep".v3_accounts a
    where a.user_id = new.actor_id and a.role in ('operador', 'administrador')) then
    raise exception 'Solo una cuenta FUP puede registrar escaneos';
  end if;
  return new;
end;
$$;
commit;
notify pgrst, 'reload schema';
