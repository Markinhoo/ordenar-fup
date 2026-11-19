-- Run only in the aria-arquitectura project. This migration creates objects
-- exclusively in the existing quoted schema "fup-sep". Legacy rooms remain intact.
create schema if not exists "fup-sep";

create table if not exists "fup-sep".v2_batches (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  file_name text not null,
  qna text not null check (qna ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[12]$'),
  created_at timestamptz not null default now()
);

create table if not exists "fup-sep".v2_workers (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references "fup-sep".v2_batches(id) on delete cascade,
  token text not null unique check (token ~ '^[0-9a-f]{64}$'),
  name text not null,
  email text not null,
  user_id uuid,
  target_count integer not null check (target_count between 0 and 2000),
  sort_order integer not null,
  unique (batch_id, email),
  unique (batch_id, sort_order)
);

create table if not exists "fup-sep".v2_records (
  id bigint generated always as identity primary key,
  batch_id uuid not null references "fup-sep".v2_batches(id) on delete cascade,
  position integer not null,
  folio text not null,
  folio_digits text not null,
  rfc text,
  assigned_worker_id uuid references "fup-sep".v2_workers(id),
  digital boolean not null default true,
  observation text,
  checked_at timestamptz,
  checked_by uuid,
  checked_by_name text,
  source text,
  procedencia text,
  nivel text,
  document_date date,
  unique (batch_id, position)
);
create index if not exists v2_records_batch_folio_idx on "fup-sep".v2_records(batch_id, folio_digits);

create table if not exists "fup-sep".v2_events (
  id bigint generated always as identity primary key,
  batch_id uuid not null references "fup-sep".v2_batches(id) on delete cascade,
  record_id bigint not null references "fup-sep".v2_records(id) on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  action text not null check (action in ('scan', 'rescan', 'manual_mark', 'manual_unmark', 'manual_add')),
  folio text not null,
  rfc text,
  procedencia text,
  nivel text,
  document_date date,
  observation text,
  created_at timestamptz not null default now()
);
create index if not exists v2_events_batch_time_idx on "fup-sep".v2_events(batch_id, created_at desc);

alter table "fup-sep".v2_batches enable row level security;
alter table "fup-sep".v2_workers enable row level security;
alter table "fup-sep".v2_records enable row level security;
alter table "fup-sep".v2_events enable row level security;
revoke all on "fup-sep".v2_batches, "fup-sep".v2_workers,
  "fup-sep".v2_records, "fup-sep".v2_events from public, anon, authenticated;
revoke all on all sequences in schema "fup-sep" from public, anon, authenticated;
grant usage on schema "fup-sep" to authenticated;

create or replace function "fup-sep".v2_create_batch(
  p_file_name text, p_qna text, p_records jsonb, p_workers jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid;
  v_worker jsonb;
  v_record jsonb;
  v_name text;
  v_email text;
  v_target integer;
  v_token text;
  v_worker_id uuid;
  v_ids uuid[] := '{}';
  v_limits integer[] := '{}';
  v_total integer := 0;
  v_order integer := 0;
  v_position integer := 0;
  v_assignee uuid;
  v_digits text;
  v_i integer;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_file_name is null or length(trim(p_file_name)) not between 1 and 160
    or p_qna is null or p_qna !~ '^[0-9]{4}-(0[1-9]|1[0-2])-[12]$'
    or p_records is null or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) not between 1 and 2000
    or octet_length(p_records::text) > 200000
    or p_workers is null or jsonb_typeof(p_workers) is distinct from 'array'
    or jsonb_array_length(p_workers) not between 1 and 50 then
    raise exception 'Datos de lote inválidos';
  end if;
  insert into "fup-sep".v2_batches(admin_id, file_name, qna)
  values (auth.uid(), trim(p_file_name), p_qna) returning id into v_batch;
  for v_worker in select value from jsonb_array_elements(p_workers) as x(value) loop
    v_order := v_order + 1;
    v_name := trim(coalesce(v_worker->>'name', ''));
    v_email := lower(trim(coalesce(v_worker->>'email', '')));
    if length(v_name) not between 2 and 80
      or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or (v_worker->>'target') !~ '^[0-9]{1,4}$' then
      raise exception 'Nombre, correo o cantidad inválidos';
    end if;
    v_target := (v_worker->>'target')::integer;
    if v_target > 2000 then raise exception 'Cantidad demasiado grande'; end if;
    v_total := v_total + v_target;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into "fup-sep".v2_workers(batch_id, token, name, email, target_count, sort_order)
    values (v_batch, v_token, v_name, v_email, v_target, v_order)
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

create or replace function "fup-sep".v2_claim_worker(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_worker "fup-sep".v2_workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
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

create or replace function "fup-sep".v2_list_batches()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'qna', b.qna, 'fileName', b.file_name, 'createdAt', b.created_at,
    'total', (select count(*) from "fup-sep".v2_records r where r.batch_id = b.id),
    'checked', (select count(*) from "fup-sep".v2_records r where r.batch_id = b.id and r.checked_at is not null)
  ) order by b.created_at desc), '[]'::jsonb)
  from "fup-sep".v2_batches b where b.admin_id = auth.uid();
$$;

create or replace function "fup-sep".v2_get_batch(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_batch "fup-sep".v2_batches%rowtype;
  v_admin boolean;
  v_worker "fup-sep".v2_workers%rowtype;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select * into v_batch from "fup-sep".v2_batches where id = p_batch_id;
  if not found then raise exception 'Lote inexistente'; end if;
  v_admin := v_batch.admin_id = auth.uid();
  if not v_admin then
    select * into v_worker from "fup-sep".v2_workers
    where batch_id = p_batch_id and user_id = auth.uid();
    if not found then raise exception 'No tienes acceso a este lote'; end if;
  end if;
  return jsonb_build_object(
    'id', v_batch.id, 'fileName', v_batch.file_name, 'qna', v_batch.qna,
    'isAdmin', v_admin, 'myWorkerId', case when v_admin then null else v_worker.id end,
    'workers', coalesce((select jsonb_agg(jsonb_build_object(
      'id', w.id, 'name', w.name, 'email', case when v_admin then w.email else null end,
      'target', w.target_count, 'token', case when v_admin then w.token else null end
    ) order by w.sort_order) from "fup-sep".v2_workers w where w.batch_id = v_batch.id), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'folio', r.folio, 'rfc', r.rfc, 'assignedWorkerId', r.assigned_worker_id,
      'digital', r.digital, 'observation', r.observation, 'checkedAt', r.checked_at,
      'checkedBy', r.checked_by_name, 'source', r.source, 'procedencia', r.procedencia,
      'nivel', r.nivel, 'documentDate', r.document_date
    ) order by r.position) from "fup-sep".v2_records r where r.batch_id = v_batch.id), '[]'::jsonb)
  );
end;
$$;

create or replace function "fup-sep".v2_scan_document(
  p_batch_id uuid, p_folio text, p_procedencia text, p_nivel text, p_document_date date
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_worker "fup-sep".v2_workers%rowtype;
  v_record "fup-sep".v2_records%rowtype;
  v_count integer;
  v_folio text := trim(coalesce(p_folio, ''));
  v_procedencia text := upper(trim(coalesce(p_procedencia, '')));
  v_nivel text := upper(trim(coalesce(p_nivel, '')));
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select * into v_worker from "fup-sep".v2_workers
  where batch_id = p_batch_id and user_id = auth.uid();
  if not found then raise exception 'No tienes permiso para escanear este lote'; end if;
  if v_folio !~ '^[0-9]{1,12}$' or length(v_procedencia) not between 2 and 60
    or length(v_nivel) not between 2 and 30
    or p_document_date is null or p_document_date < date '1900-01-01'
    or p_document_date > current_date + 366 then
    raise exception 'El recuadro debe tener procedencia, nivel, folio y fecha válidos';
  end if;
  select count(*) into v_count from "fup-sep".v2_records
  where batch_id = p_batch_id and folio_digits = v_folio and digital;
  if v_count = 0 then raise exception 'El folio no existe en el Excel. Avisa a la encargada para añadirlo con observación'; end if;
  if v_count > 1 then raise exception 'Folio repetido en el Excel. La encargada debe revisar el RFC'; end if;
  select * into v_record from "fup-sep".v2_records
  where batch_id = p_batch_id and folio_digits = v_folio and digital for update;
  if v_record.assigned_worker_id is not null and v_record.assigned_worker_id <> v_worker.id then
    raise exception 'Este folio está asignado a otra persona';
  end if;
  if v_record.checked_at is null then
    update "fup-sep".v2_records set checked_at = now(), checked_by = auth.uid(),
      checked_by_name = v_worker.name, source = 'scan', procedencia = v_procedencia,
      nivel = v_nivel, document_date = p_document_date where id = v_record.id;
  end if;
  insert into "fup-sep".v2_events(batch_id, record_id, actor_id, actor_name, action,
    folio, rfc, procedencia, nivel, document_date)
  values (p_batch_id, v_record.id, auth.uid(), v_worker.name,
    case when v_record.checked_at is null then 'scan' else 'rescan' end,
    v_record.folio, v_record.rfc, v_procedencia, v_nivel, p_document_date);
  return jsonb_build_object('status', case when v_record.checked_at is null then 'new' else 'already' end,
    'folio', v_record.folio, 'rfc', v_record.rfc,
    'checkedBy', coalesce(v_record.checked_by_name, v_worker.name));
end;
$$;

create or replace function "fup-sep".v2_admin_set_status(
  p_batch_id uuid, p_record_id bigint, p_checked boolean, p_observation text
) returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_record "fup-sep".v2_records%rowtype;
begin
  if not exists (select 1 from "fup-sep".v2_batches where id = p_batch_id and admin_id = auth.uid()) then
    raise exception 'Solo la encargada puede cambiar la casilla manualmente';
  end if;
  if p_checked is null or length(trim(coalesce(p_observation, ''))) not between 5 and 500 then
    raise exception 'Escribe una observación de 5 a 500 caracteres';
  end if;
  select * into v_record from "fup-sep".v2_records
  where id = p_record_id and batch_id = p_batch_id for update;
  if not found then raise exception 'Folio inexistente'; end if;
  if p_checked then
    update "fup-sep".v2_records set checked_at = now(), checked_by = auth.uid(),
      checked_by_name = coalesce(auth.jwt()->>'email', 'Encargada'), source = 'manual'
    where id = p_record_id;
  else
    update "fup-sep".v2_records set checked_at = null, checked_by = null,
      checked_by_name = null, source = null, procedencia = null, nivel = null,
      document_date = null where id = p_record_id;
  end if;
  insert into "fup-sep".v2_events(batch_id, record_id, actor_id, actor_name, action,
    folio, rfc, procedencia, nivel, document_date, observation)
  values (p_batch_id, p_record_id, auth.uid(), coalesce(auth.jwt()->>'email', 'Encargada'),
    case when p_checked then 'manual_mark' else 'manual_unmark' end,
    v_record.folio, v_record.rfc, v_record.procedencia, v_record.nivel,
    v_record.document_date, trim(p_observation));
  return true;
end;
$$;

create or replace function "fup-sep".v2_admin_add_missing(
  p_batch_id uuid, p_folio text, p_rfc text, p_procedencia text, p_nivel text,
  p_document_date date, p_observation text, p_worker_id uuid
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_record_id bigint; v_position integer; v_folio text := trim(coalesce(p_folio, ''));
begin
  if not exists (select 1 from "fup-sep".v2_batches where id = p_batch_id and admin_id = auth.uid()) then
    raise exception 'Solo la encargada puede añadir un documento';
  end if;
  perform 1 from "fup-sep".v2_batches where id = p_batch_id for update;
  if v_folio !~ '^[0-9]{1,12}$' or length(trim(coalesce(p_observation, ''))) not between 5 and 500
    or length(trim(coalesce(p_procedencia, ''))) not between 2 and 60
    or length(trim(coalesce(p_nivel, ''))) not between 2 and 30
    or p_document_date is null or p_document_date < date '1900-01-01'
    or p_document_date > current_date + 366
    or length(trim(coalesce(p_rfc, ''))) > 30 then
    raise exception 'Completa folio, procedencia, nivel, fecha y observación';
  end if;
  if exists (select 1 from "fup-sep".v2_records where batch_id = p_batch_id and folio_digits = v_folio) then
    raise exception 'Ese folio ya existe en este lote';
  end if;
  if p_worker_id is not null and not exists (
    select 1 from "fup-sep".v2_workers where id = p_worker_id and batch_id = p_batch_id
  ) then raise exception 'Persona asignada inválida'; end if;
  select coalesce(max(position), 0) + 1 into v_position
  from "fup-sep".v2_records where batch_id = p_batch_id;
  insert into "fup-sep".v2_records(batch_id, position, folio, folio_digits, rfc,
    assigned_worker_id, digital, observation, checked_at, checked_by, checked_by_name,
    source, procedencia, nivel, document_date)
  values (p_batch_id, v_position, v_folio, v_folio, nullif(upper(trim(coalesce(p_rfc, ''))), ''),
    p_worker_id, false, trim(p_observation), now(), auth.uid(),
    coalesce(auth.jwt()->>'email', 'Encargada'), 'manual_add',
    upper(trim(p_procedencia)), upper(trim(p_nivel)), p_document_date)
  returning id into v_record_id;
  insert into "fup-sep".v2_events(batch_id, record_id, actor_id, actor_name, action,
    folio, rfc, procedencia, nivel, document_date, observation)
  values (p_batch_id, v_record_id, auth.uid(), coalesce(auth.jwt()->>'email', 'Encargada'),
    'manual_add', v_folio, nullif(upper(trim(coalesce(p_rfc, ''))), ''),
    upper(trim(p_procedencia)), upper(trim(p_nivel)), p_document_date, trim(p_observation));
  return jsonb_build_object('recordId', v_record_id);
end;
$$;

create or replace function "fup-sep".v2_search_history(p_query text, p_qna text, p_offset integer default 0)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'qna', b.qna, 'fileName', b.file_name, 'at', e.created_at,
    'action', e.action, 'folio', e.folio, 'rfc', e.rfc, 'actor', e.actor_name,
    'procedencia', e.procedencia, 'nivel', e.nivel, 'documentDate', e.document_date,
    'observation', e.observation
  ) order by e.created_at desc), '[]'::jsonb)
  from (select ev.* from "fup-sep".v2_events ev
    join "fup-sep".v2_batches batch on batch.id = ev.batch_id
    where batch.admin_id = auth.uid()
      and (p_qna is null or p_qna = '' or batch.qna = p_qna)
      and (coalesce(p_query, '') = '' or ev.folio ilike '%' || p_query || '%'
        or ev.actor_name ilike '%' || p_query || '%'
        or coalesce(ev.rfc, '') ilike '%' || p_query || '%')
    order by ev.created_at desc, ev.id desc limit 200 offset greatest(coalesce(p_offset, 0), 0)) e
  join "fup-sep".v2_batches b on b.id = e.batch_id;
$$;

revoke all on function "fup-sep".v2_create_batch(text, text, jsonb, jsonb) from public, anon;
revoke all on function "fup-sep".v2_claim_worker(text) from public, anon;
revoke all on function "fup-sep".v2_list_batches() from public, anon;
revoke all on function "fup-sep".v2_get_batch(uuid) from public, anon;
revoke all on function "fup-sep".v2_scan_document(uuid, text, text, text, date) from public, anon;
revoke all on function "fup-sep".v2_admin_set_status(uuid, bigint, boolean, text) from public, anon;
revoke all on function "fup-sep".v2_admin_add_missing(uuid, text, text, text, text, date, text, uuid) from public, anon;
revoke all on function "fup-sep".v2_search_history(text, text, integer) from public, anon;
grant execute on function "fup-sep".v2_create_batch(text, text, jsonb, jsonb) to authenticated;
grant execute on function "fup-sep".v2_claim_worker(text) to authenticated;
grant execute on function "fup-sep".v2_list_batches() to authenticated;
grant execute on function "fup-sep".v2_get_batch(uuid) to authenticated;
grant execute on function "fup-sep".v2_scan_document(uuid, text, text, text, date) to authenticated;
grant execute on function "fup-sep".v2_admin_set_status(uuid, bigint, boolean, text) to authenticated;
grant execute on function "fup-sep".v2_admin_add_missing(uuid, text, text, text, text, date, text, uuid) to authenticated;
grant execute on function "fup-sep".v2_search_history(text, text, integer) to authenticated;
notify pgrst, 'reload schema';
