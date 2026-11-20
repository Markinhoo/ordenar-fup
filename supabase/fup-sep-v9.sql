-- Allow assigned operators to help with any folio in their own batch.
-- Keep the original assignment and the full scan history in fup-sep.
begin;

create or replace function "fup-sep".v2_scan_document(
  p_batch_id uuid, p_folio text, p_procedencia text, p_nivel text, p_document_date date
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_worker "fup-sep".v2_workers%rowtype;
  v_record "fup-sep".v2_records%rowtype;
  v_actor_name text;
  v_was_checked boolean;
  v_count integer;
  v_folio text := trim(coalesce(p_folio, ''));
  v_procedencia text := upper(trim(coalesce(p_procedencia, '')));
  v_nivel text := upper(trim(coalesce(p_nivel, '')));
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select a.name into v_actor_name from "fup-sep".v3_accounts a
  where a.user_id = auth.uid() and a.role = 'operador';
  if v_actor_name is null then raise exception 'Solo un operador puede registrar escaneos'; end if;
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
  v_was_checked := v_record.checked_at is not null;
  update "fup-sep".v2_records set checked_at = now(), checked_by = auth.uid(),
    checked_by_name = v_actor_name, source = 'scan', procedencia = v_procedencia,
    nivel = v_nivel, document_date = p_document_date where id = v_record.id;
  insert into "fup-sep".v2_events(batch_id, record_id, actor_id, actor_name, action,
    folio, rfc, procedencia, nivel, document_date)
  values (p_batch_id, v_record.id, auth.uid(), v_actor_name,
    case when v_was_checked then 'rescan' else 'scan' end,
    v_record.folio, v_record.rfc, v_procedencia, v_nivel, p_document_date);
  return jsonb_build_object('status', case when v_was_checked then 'already' else 'new' end,
    'folio', v_record.folio, 'rfc', v_record.rfc, 'checkedBy', v_actor_name);
end;
$$;

commit;
notify pgrst, 'reload schema';
