-- Atomic administrator corrections; only the fup-sep schema is changed.
begin;
alter table "fup-sep".v2_events drop constraint if exists v2_events_action_check;
alter table "fup-sep".v2_events add constraint v2_events_action_check check
  (action in ('scan','rescan','manual_mark','manual_unmark','manual_add','correction'));
create or replace function "fup-sep".v14_correct_document(
 p_batch_id uuid, p_record_id bigint, p_procedencia text, p_nivel text,
 p_document_date date, p_observation text, p_expected jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare r "fup-sep".v2_records%rowtype; actor text;
 src text := upper(trim(coalesce(p_procedencia,''))); lvl text := upper(trim(coalesce(p_nivel,'')));
begin
 if not exists(select 1 from "fup-sep".v2_batches where id=p_batch_id and admin_id=auth.uid() and "fup-sep".v2_is_admin()) then
   raise exception 'Solo el administrador del lote puede corregir documentos'; end if;
 if src not in ('ESTATAL','FEDERAL','MUNICIPAL') or lvl not in ('PREE','PRIMARIAE','SECUNDARIA','BASICA B','ADGE','FISICAE','PREPARATORIA')
   or p_document_date is null or p_document_date < date '1900-01-01' or p_document_date > current_date+366
   or length(trim(coalesce(p_observation,''))) not between 5 and 500 then raise exception 'Revisa los datos y escribe el motivo de la corrección'; end if;
 select * into r from "fup-sep".v2_records where id=p_record_id and batch_id=p_batch_id for update;
 if not found or r.checked_at is null then raise exception 'El documento debe estar revisado'; end if;
 if p_expected is distinct from jsonb_build_object('procedencia',r.procedencia,'nivel',r.nivel,'documentDate',r.document_date) then
   raise exception 'El documento cambió. Cierra, actualiza el listado y vuelve a intentarlo'; end if;
 if r.procedencia is not distinct from src and r.nivel is not distinct from lvl and r.document_date is not distinct from p_document_date then
   raise exception 'No hay cambios que guardar'; end if;
 select name into actor from "fup-sep".v3_accounts where user_id=auth.uid();
 update "fup-sep".v2_records set procedencia=src,nivel=lvl,document_date=p_document_date where id=r.id;
 insert into "fup-sep".v2_events(batch_id,record_id,actor_id,actor_name,action,folio,rfc,procedencia,nivel,document_date,observation)
 values(p_batch_id,r.id,auth.uid(),coalesce(actor,'Administrador'),'correction',r.folio,r.rfc,src,lvl,p_document_date,
   format('Antes: %s | %s | %s. Después: %s | %s | %s. Motivo: %s',coalesce(r.procedencia,'—'),coalesce(r.nivel,'—'),coalesce(r.document_date::text,'—'),src,lvl,p_document_date,trim(p_observation)));
 return true;
end; $$;
revoke all on function "fup-sep".v14_correct_document(uuid,bigint,text,text,date,text,jsonb) from public,anon;
grant execute on function "fup-sep".v14_correct_document(uuid,bigint,text,text,date,text,jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
