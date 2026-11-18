-- Run only in the aria-arquitectura Supabase project.
-- This migration creates objects exclusively inside the quoted schema "fup-sep".
create schema if not exists "fup-sep";

create table if not exists "fup-sep".rooms (
  secret text primary key,
  file_name text not null,
  records jsonb not null,
  created_at timestamptz not null default now(),
  constraint room_secret_format check (secret ~ '^[0-9a-f]{64}$'),
  constraint room_records_array check (jsonb_typeof(records) = 'array')
);

create table if not exists "fup-sep".marks (
  room_secret text not null references "fup-sep".rooms(secret) on delete cascade,
  record_id integer not null,
  checked_at timestamptz not null default now(),
  primary key (room_secret, record_id)
);

alter table "fup-sep".rooms enable row level security;
alter table "fup-sep".marks enable row level security;
revoke all on schema "fup-sep" from public;
revoke all on all tables in schema "fup-sep" from public, anon, authenticated;
grant usage on schema "fup-sep" to anon, authenticated;

create or replace function "fup-sep".create_room(p_file_name text, p_records jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if p_file_name is null or length(trim(p_file_name)) < 1 or length(p_file_name) > 160
     or p_records is null or jsonb_typeof(p_records) is distinct from 'array'
     or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 2000
     or octet_length(p_records::text) > 200000 then
    raise exception 'Lista inválida o demasiado grande';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_records) as item
    where jsonb_typeof(item->'folio') is distinct from 'string'
       or jsonb_typeof(item->'rfc') is distinct from 'string'
       or length(item->>'folio') not between 1 and 30
       or length(item->>'rfc') not between 1 and 30
  ) then
    raise exception 'Los registros requieren folio y RFC';
  end if;
  insert into "fup-sep".rooms(secret, file_name, records)
  values (v_secret, trim(p_file_name), p_records);
  insert into "fup-sep".marks(room_secret, record_id)
  select v_secret, (entry.ordinality - 1)::integer
  from jsonb_array_elements(p_records) with ordinality as entry(item, ordinality)
  where entry.item->>'checked' = 'true';
  return v_secret;
end;
$$;

create or replace function "fup-sep".get_room(p_secret text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'fileName', r.file_name,
    'records', r.records,
    'verified', coalesce((select jsonb_agg(m.record_id order by m.record_id)
                          from "fup-sep".marks m where m.room_secret = r.secret), '[]'::jsonb)
  )
  from "fup-sep".rooms r
  where r.secret = p_secret;
$$;

create or replace function "fup-sep".set_mark(p_secret text, p_record_id integer, p_checked boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  select jsonb_array_length(records) into v_count
  from "fup-sep".rooms where secret = p_secret;
  if v_count is null or p_record_id is null or p_record_id < 0
     or p_record_id >= v_count or p_checked is null then
    raise exception 'Sala o folio inválido';
  end if;
  if p_checked then
    insert into "fup-sep".marks(room_secret, record_id)
    values (p_secret, p_record_id)
    on conflict (room_secret, record_id) do nothing;
  else
    delete from "fup-sep".marks
    where room_secret = p_secret and record_id = p_record_id;
  end if;
  return true;
end;
$$;

create or replace function "fup-sep".clear_marks(p_secret text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from "fup-sep".rooms where secret = p_secret) then
    raise exception 'Sala inválida';
  end if;
  delete from "fup-sep".marks where room_secret = p_secret;
  return true;
end;
$$;

revoke all on all functions in schema "fup-sep" from public;
grant execute on function "fup-sep".create_room(text, jsonb) to anon, authenticated;
grant execute on function "fup-sep".get_room(text) to anon, authenticated;
grant execute on function "fup-sep".set_mark(text, integer, boolean) to anon, authenticated;
grant execute on function "fup-sep".clear_marks(text) to anon, authenticated;
notify pgrst, 'reload schema';
