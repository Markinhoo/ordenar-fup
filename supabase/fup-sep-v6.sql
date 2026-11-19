-- Compact QNA (YYYY01..YYYY24) and server-side even distribution.
-- Only objects in the isolated "fup-sep" schema are changed.
begin;
alter table "fup-sep".v2_batches drop constraint if exists v2_batches_qna_check;
update "fup-sep".v2_batches
set qna = substring(qna from 1 for 4) ||
  lpad((((substring(qna from 6 for 2))::integer - 1) * 2 +
    (substring(qna from 9 for 1))::integer)::text, 2, '0')
where qna ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[12]$';
alter table "fup-sep".v2_batches add constraint v2_batches_qna_check
  check (qna ~ '^[0-9]{4}(0[1-9]|1[0-9]|2[0-4])$');

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
  v_emails text[] := '{}';
  v_total integer := 0;
  v_order integer := 0;
  v_position integer := 0;
  v_count integer;
  v_record_count integer;
  v_assignee uuid;
  v_digits text;
  v_i integer;
begin
  if not "fup-sep".v2_is_admin() then raise exception 'Solo la cuenta administradora puede cargar Excel'; end if;
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
  insert into "fup-sep".v2_batches(admin_id, file_name, qna)
  values (auth.uid(), trim(p_file_name), p_qna) returning id into v_batch;
  for v_worker in select value from jsonb_array_elements(p_workers) as x(value) loop
    v_order := v_order + 1;
    v_email := lower(trim(coalesce(v_worker->>'email', '')));
    select a.name into v_name from "fup-sep".v3_accounts a where a.email = v_email;
    if v_name is null or v_email = any(v_emails) then
      raise exception 'Selecciona cuentas diferentes creadas en Usuarios';
    end if;
    v_emails := array_append(v_emails, v_email);
    v_target := v_record_count / v_count + case when v_order <= v_record_count % v_count then 1 else 0 end;
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
commit;
notify pgrst, 'reload schema';
