-- Usernames, roles, and automatic operator assignment for Ordenar FUP.
-- This migration changes only objects in the quoted "fup-sep" schema.
begin;

alter table "fup-sep".v3_accounts add column if not exists username text;
alter table "fup-sep".v3_accounts add column if not exists role text not null default 'operador';
update "fup-sep".v3_accounts
set username = case when email = 'nomina@fup.com' then 'nomina'
  else 'u_' || left(replace(user_id::text, '-', ''), 16) end
where username is null;
update "fup-sep".v3_accounts set role = 'administrador'
where email in (select email from "fup-sep".v2_admin_accounts);
alter table "fup-sep".v3_accounts alter column username set not null;
create unique index if not exists v3_accounts_username_key on "fup-sep".v3_accounts(username);
alter table "fup-sep".v3_accounts drop constraint if exists v3_accounts_role_check;
alter table "fup-sep".v3_accounts add constraint v3_accounts_role_check
  check (role in ('administrador', 'operador'));
alter table "fup-sep".v3_accounts drop constraint if exists v3_accounts_username_check;
alter table "fup-sep".v3_accounts add constraint v3_accounts_username_check
  check (username ~ '^[a-z][a-z0-9._-]{2,31}$');

create or replace function "fup-sep".v2_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from "fup-sep".v3_accounts a
    where a.user_id = auth.uid() and a.role = 'administrador'
  );
$$;

create or replace function "fup-sep".v7_keep_admin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'administrador' and new.role <> 'administrador' then
    perform pg_catalog.pg_advisory_xact_lock(2026, 7);
    if (select count(*) from "fup-sep".v3_accounts where role = 'administrador') <= 1 then
      raise exception 'Debe quedar al menos una cuenta administradora';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists v7_keep_admin on "fup-sep".v3_accounts;
create trigger v7_keep_admin before update of role on "fup-sep".v3_accounts
for each row execute function "fup-sep".v7_keep_admin();

create or replace function "fup-sep".v7_link_worker()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select a.user_id into new.user_id from "fup-sep".v3_accounts a
  where a.email = lower(new.email) and a.role = 'operador';
  if new.user_id is null then raise exception 'Selecciona una cuenta operadora válida'; end if;
  return new;
end;
$$;
drop trigger if exists v7_link_worker on "fup-sep".v2_workers;
create trigger v7_link_worker before insert on "fup-sep".v2_workers
for each row execute function "fup-sep".v7_link_worker();

create or replace function "fup-sep".v2_create_batch(
  p_file_name text, p_qna text, p_records jsonb, p_workers jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid;
  v_worker jsonb;
  v_record jsonb;
  v_user_id uuid;
  v_name text;
  v_email text;
  v_target integer;
  v_token text;
  v_worker_id uuid;
  v_ids uuid[] := '{}';
  v_limits integer[] := '{}';
  v_user_ids uuid[] := '{}';
  v_total integer := 0;
  v_order integer := 0;
  v_position integer := 0;
  v_count integer;
  v_record_count integer;
  v_assignee uuid;
  v_digits text;
  v_i integer;
begin
  if not "fup-sep".v2_is_admin() then raise exception 'Solo una cuenta administradora puede cargar Excel'; end if;
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_file_name is null or length(trim(p_file_name)) not between 1 and 160
    or p_qna is null or p_qna !~ '^[0-9]{4}(0[1-9]|1[0-9]|2[0-4])$'
    or p_records is null or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) not between 1 and 2000
    or octet_length(p_records::text) > 200000
    or p_workers is null or jsonb_typeof(p_workers) is distinct from 'array'
    or jsonb_array_length(p_workers) not between 1 and 50 then
    raise exception 'Datos de lote inválidos';
  end if;
  v_count := jsonb_array_length(p_workers);
  v_record_count := jsonb_array_length(p_records);
  if v_count > v_record_count then raise exception 'Hay más operadores que registros'; end if;
  insert into "fup-sep".v2_batches(admin_id, file_name, qna)
  values (auth.uid(), trim(p_file_name), p_qna) returning id into v_batch;
  for v_worker in select value from jsonb_array_elements(p_workers) as x(value) loop
    v_order := v_order + 1;
    v_user_id := nullif(v_worker->>'userId', '')::uuid;
    select a.name, a.email into v_name, v_email from "fup-sep".v3_accounts a
    where a.user_id = v_user_id and a.role = 'operador';
    if v_user_id is null or v_name is null or v_user_id = any(v_user_ids) then
      raise exception 'Selecciona operadores diferentes creados en Usuarios';
    end if;
    v_user_ids := array_append(v_user_ids, v_user_id);
    v_target := v_record_count / v_count + case when v_order <= v_record_count % v_count then 1 else 0 end;
    v_total := v_total + v_target;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into "fup-sep".v2_workers(batch_id, token, name, email, user_id, target_count, sort_order)
    values (v_batch, v_token, v_name, v_email, v_user_id, v_target, v_order)
    returning id into v_worker_id;
    v_ids := array_append(v_ids, v_worker_id);
    v_limits := array_append(v_limits, v_total);
  end loop;
  for v_record in
    select value from jsonb_array_elements(p_records) as x(value)
    order by upper(value->>'rfc'), value->>'folio'
  loop
    if jsonb_typeof(v_record->'folio') is distinct from 'string'
      or jsonb_typeof(v_record->'rfc') is distinct from 'string'
      or length(trim(v_record->>'folio')) not between 1 and 30
      or length(trim(v_record->>'rfc')) not between 1 and 30 then
      raise exception 'RFC o folio inválido';
    end if;
    v_digits := substring(trim(v_record->>'folio') from '^[0-9]+');
    if v_digits is null then raise exception 'El folio debe comenzar con números'; end if;
    v_position := v_position + 1;
    v_assignee := null;
    for v_i in 1..array_length(v_ids, 1) loop
      if v_position <= v_limits[v_i] then v_assignee := v_ids[v_i]; exit; end if;
    end loop;
    insert into "fup-sep".v2_records(batch_id, position, folio, folio_digits, rfc, assigned_worker_id)
    values (v_batch, v_position, trim(v_record->>'folio'), v_digits, upper(trim(v_record->>'rfc')), v_assignee);
  end loop;
  return jsonb_build_object('batchId', v_batch, 'qna', p_qna);
end;
$$;

create or replace function "fup-sep".v7_enforce_operator_scan()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from "fup-sep".v3_accounts a
    where a.user_id = new.actor_id and a.role = 'operador') then
    raise exception 'Solo una cuenta operadora puede registrar escaneos';
  end if;
  return new;
end;
$$;
drop trigger if exists v7_operator_scan on "fup-sep".v2_events;
create trigger v7_operator_scan before insert on "fup-sep".v2_events
for each row when (new.action in ('scan', 'rescan'))
execute function "fup-sep".v7_enforce_operator_scan();

create or replace function "fup-sep".v2_list_batches()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'qna', b.qna, 'fileName', b.file_name, 'createdAt', b.created_at,
    'total', (select count(*) from "fup-sep".v2_records r where r.batch_id = b.id),
    'checked', (select count(*) from "fup-sep".v2_records r where r.batch_id = b.id and r.checked_at is not null)
  ) order by b.created_at desc), '[]'::jsonb)
  from "fup-sep".v2_batches b
  where (b.admin_id = auth.uid() and "fup-sep".v2_is_admin())
    or (exists (select 1 from "fup-sep".v2_workers w
      join "fup-sep".v3_accounts a on a.user_id = w.user_id
      where w.batch_id = b.id and w.user_id = auth.uid() and a.role = 'operador'));
$$;

revoke all on function "fup-sep".v7_keep_admin() from public, anon, authenticated;
revoke all on function "fup-sep".v7_link_worker() from public, anon, authenticated;
revoke all on function "fup-sep".v7_enforce_operator_scan() from public, anon, authenticated;
commit;
notify pgrst, 'reload schema';
