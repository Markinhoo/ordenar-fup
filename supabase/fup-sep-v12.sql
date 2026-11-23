-- Let the administrator who owns a batch scan its documents and pair a phone.
-- Changes are limited to routines in the existing fup-sep schema.
begin;

create or replace function "fup-sep".v10_issue_device_pair()
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  if auth.uid() is null or not exists (
    select 1 from "fup-sep".v3_accounts
    where user_id = auth.uid() and role in ('operador', 'administrador')
  ) then raise exception 'Inicia sesión en una cuenta FUP para abrir tu QR'; end if;
  delete from "fup-sep".v10_device_pairs where user_id = auth.uid() or expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into "fup-sep".v10_device_pairs(token_hash,user_id,expires_at)
  values (encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid(),now() + interval '2 minutes');
  return v_token;
end;
$$;

create or replace function "fup-sep".v2_scan_document(
  p_batch_id uuid, p_folio text, p_procedencia text, p_nivel text, p_document_date date
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_record "fup-sep".v2_records%rowtype;
  v_actor_name text;
  v_role text;
  v_count integer;
  v_folio text := trim(coalesce(p_folio, ''));
  v_procedencia text := upper(trim(coalesce(p_procedencia, '')));
  v_nivel text := upper(trim(coalesce(p_nivel, '')));
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select a.name, a.role into v_actor_name, v_role from "fup-sep".v3_accounts a
  where a.user_id = auth.uid() and a.role in ('operador', 'administrador');
  if v_actor_name is null then raise exception 'Cuenta sin permiso para registrar escaneos'; end if;
  if not (
    (v_role = 'operador' and exists (
      select 1 from "fup-sep".v2_workers
      where batch_id = p_batch_id and user_id = auth.uid()
    )) or
    (v_role = 'administrador' and exists (
      select 1 from "fup-sep".v2_batches
      where id = p_batch_id and admin_id = auth.uid()
    ))
  ) then raise exception 'No tienes permiso para escanear este lote'; end if;
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
  if v_record.checked_at is not null then
    return jsonb_build_object('status', 'already', 'folio', v_record.folio,
      'rfc', v_record.rfc, 'checkedBy', v_record.checked_by_name);
  end if;
  update "fup-sep".v2_records set checked_at = now(), checked_by = auth.uid(),
    checked_by_name = v_actor_name, source = 'scan', procedencia = v_procedencia,
    nivel = v_nivel, document_date = p_document_date where id = v_record.id;
  insert into "fup-sep".v2_events(batch_id, record_id, actor_id, actor_name, action,
    folio, rfc, procedencia, nivel, document_date)
  values (p_batch_id, v_record.id, auth.uid(), v_actor_name,
    'scan', v_record.folio, v_record.rfc, v_procedencia, v_nivel, p_document_date);
  return jsonb_build_object('status', 'new',
    'folio', v_record.folio, 'rfc', v_record.rfc, 'checkedBy', v_actor_name);
end;
$$;

commit;
notify pgrst, 'reload schema';
