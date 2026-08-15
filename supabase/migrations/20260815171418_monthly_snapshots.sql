alter table public.imports
  add column if not exists report_type text;

alter table public.imports
  drop constraint if exists imports_report_type_check;

alter table public.imports
  add constraint imports_report_type_check
  check (report_type is null or report_type in ('new', 'rank', 'pcm', 'general'));

alter table public.distributors
  add column if not exists first_seen_period date,
  add column if not exists last_seen_period date;

alter table public.distributors
  drop constraint if exists distributors_first_seen_period_month_start,
  drop constraint if exists distributors_last_seen_period_month_start,
  drop constraint if exists distributors_seen_period_order;

alter table public.distributors
  add constraint distributors_first_seen_period_month_start
    check (first_seen_period is null or first_seen_period = date_trunc('month', first_seen_period)::date),
  add constraint distributors_last_seen_period_month_start
    check (last_seen_period is null or last_seen_period = date_trunc('month', last_seen_period)::date),
  add constraint distributors_seen_period_order
    check (first_seen_period is null or last_seen_period is null or first_seen_period <= last_seen_period);

create table if not exists public.distributor_snapshots (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  period date not null,
  current_rank text,
  target_rank text,
  gap_to_rank numeric(14, 2) check (gap_to_rank is null or gap_to_rank >= 0),
  is_new_distributor boolean not null default false,
  is_rank_opportunity boolean not null default false,
  is_pcm_opportunity boolean not null default false,
  nearest_leader_name text,
  highest_rank_name text,
  first_time_at_rank boolean,
  has_ten_pack boolean,
  source_contacted_by text,
  source_notes text,
  source_file_name text,
  import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distributor_snapshots_period_month_start
    check (period = date_trunc('month', period)::date),
  constraint distributor_snapshots_distributor_period_key
    unique (distributor_id, period)
);

create index if not exists distributor_snapshots_period_idx
  on public.distributor_snapshots(period);

create index if not exists distributor_snapshots_distributor_id_idx
  on public.distributor_snapshots(distributor_id);

create index if not exists distributors_first_seen_period_idx
  on public.distributors(first_seen_period);

create index if not exists distributors_last_seen_period_idx
  on public.distributors(last_seen_period);

drop trigger if exists distributor_snapshots_set_updated_at on public.distributor_snapshots;
create trigger distributor_snapshots_set_updated_at
before update on public.distributor_snapshots
for each row execute function private.set_updated_at();

alter table public.distributor_snapshots enable row level security;

drop policy if exists "employees can view distributor snapshots" on public.distributor_snapshots;
create policy "employees can view distributor snapshots"
on public.distributor_snapshots for select to authenticated
using ((select private.is_unicity_employee()));

revoke all on table public.distributor_snapshots from public, anon, authenticated;
grant select on table public.distributor_snapshots to authenticated;

insert into public.distributor_snapshots (
  distributor_id,
  period,
  current_rank,
  target_rank,
  gap_to_rank,
  is_new_distributor,
  is_rank_opportunity,
  is_pcm_opportunity,
  nearest_leader_name,
  highest_rank_name,
  first_time_at_rank,
  has_ten_pack,
  source_contacted_by,
  source_notes,
  source_file_name,
  import_id
)
select
  distributors.id,
  date_trunc('month', coalesce(distributors.source_period, date '2026-07-01'))::date,
  distributors.current_rank,
  distributors.target_rank,
  distributors.gap_to_rank,
  distributors.is_new_distributor,
  distributors.is_rank_opportunity,
  distributors.is_pcm_opportunity,
  distributors.nearest_leader_name,
  distributors.highest_rank_name,
  distributors.first_time_at_rank,
  distributors.has_ten_pack,
  distributors.source_contacted_by,
  distributors.source_notes,
  distributors.source_file_name,
  distributors.source_import_id
from public.distributors distributors
on conflict (distributor_id, period) do nothing;

update public.distributors
set
  first_seen_period = date_trunc('month', coalesce(source_period, date '2026-07-01'))::date,
  last_seen_period = date_trunc('month', coalesce(source_period, date '2026-07-01'))::date
where first_seen_period is null or last_seen_period is null;

create or replace function public.import_report(
  p_rows jsonb,
  p_period date,
  p_file_name text,
  p_report_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_period date;
  normalized_report_type text;
  import_id uuid;
  imported_by_name text;
  new_count integer := 0;
  update_count integer := 0;
  reappear_count integer := 0;
  invalid_count integer := 0;
begin
  if (select auth.uid()) is null or not (select private.is_topup_admin()) then
    raise exception 'Only a Top Up administrator can import reports.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The import must contain at least one row.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'The import exceeds the 20,000 row safety limit.' using errcode = '22023';
  end if;

  normalized_period := date_trunc('month', p_period)::date;
  if p_period is null or p_period <> normalized_period then
    raise exception 'The report period must be the first day of a month.' using errcode = '22023';
  end if;

  normalized_report_type := lower(btrim(coalesce(p_report_type, '')));
  if normalized_report_type not in ('new', 'rank', 'pcm', 'general') then
    raise exception 'The report type is invalid.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_file_name, '')), '') is null then
    raise exception 'The source file name is required.' using errcode = '22023';
  end if;

  select count(*)::integer
  into invalid_count
  from jsonb_array_elements(p_rows) source(row_data)
  where coalesce(source.row_data ->> 'external_id', '') !~ '^[0-9]+$'
    or nullif(btrim(coalesce(source.row_data ->> 'name', '')), '') is null
    or (
      nullif(btrim(coalesce(source.row_data ->> 'gap_to_rank', '')), '') is not null
      and coalesce(source.row_data ->> 'gap_to_rank', '') !~ '^([0-9]+([.][0-9]+)?|[.][0-9]+)$'
    );

  if invalid_count > 0 then
    raise exception '% import rows contain an invalid distributor ID, name, or rank gap.', invalid_count using errcode = '22023';
  end if;

  create temporary table pg_temp.topup_import_rows (
    external_id text primary key,
    name text not null,
    email text not null,
    phone text,
    country text not null,
    region text,
    joined_at date,
    current_rank text,
    target_rank text,
    gap_to_rank numeric(14, 2),
    is_new_distributor boolean not null,
    is_rank_opportunity boolean not null,
    is_pcm_opportunity boolean not null,
    nearest_leader_name text,
    highest_rank_name text,
    first_time_at_rank boolean,
    has_ten_pack boolean,
    source_contacted_by text,
    source_notes text
  ) on commit drop;

  insert into pg_temp.topup_import_rows (
    external_id,
    name,
    email,
    phone,
    country,
    region,
    joined_at,
    current_rank,
    target_rank,
    gap_to_rank,
    is_new_distributor,
    is_rank_opportunity,
    is_pcm_opportunity,
    nearest_leader_name,
    highest_rank_name,
    first_time_at_rank,
    has_ten_pack,
    source_contacted_by,
    source_notes
  )
  select
    dedup.row_data ->> 'external_id',
    btrim(dedup.row_data ->> 'name'),
    btrim(coalesce(dedup.row_data ->> 'email', '')),
    nullif(btrim(coalesce(dedup.row_data ->> 'phone', '')), ''),
    coalesce(nullif(btrim(coalesce(dedup.row_data ->> 'country', '')), ''), 'Unknown'),
    nullif(btrim(coalesce(dedup.row_data ->> 'region', '')), ''),
    case
      when coalesce(dedup.row_data ->> 'joined_at', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (dedup.row_data ->> 'joined_at')::date
      else null
    end,
    nullif(btrim(coalesce(dedup.row_data ->> 'current_rank', '')), ''),
    nullif(btrim(coalesce(dedup.row_data ->> 'target_rank', '')), ''),
    nullif(btrim(coalesce(dedup.row_data ->> 'gap_to_rank', '')), '')::numeric(14, 2),
    normalized_report_type = 'new' or lower(coalesce(dedup.row_data ->> 'is_new_distributor', 'false')) in ('true', '1', 'yes'),
    normalized_report_type = 'rank' or lower(coalesce(dedup.row_data ->> 'is_rank_opportunity', 'false')) in ('true', '1', 'yes'),
    normalized_report_type = 'pcm' or lower(coalesce(dedup.row_data ->> 'is_pcm_opportunity', 'false')) in ('true', '1', 'yes'),
    nullif(btrim(coalesce(dedup.row_data ->> 'nearest_leader_name', '')), ''),
    nullif(btrim(coalesce(dedup.row_data ->> 'highest_rank_name', '')), ''),
    case when jsonb_typeof(dedup.row_data -> 'first_time_at_rank') = 'boolean' then (dedup.row_data ->> 'first_time_at_rank')::boolean else null end,
    case when jsonb_typeof(dedup.row_data -> 'has_ten_pack') = 'boolean' then (dedup.row_data ->> 'has_ten_pack')::boolean else null end,
    nullif(btrim(coalesce(dedup.row_data ->> 'source_contacted_by', '')), ''),
    nullif(btrim(coalesce(dedup.row_data ->> 'source_notes', '')), '')
  from (
    select distinct on (source.row_data ->> 'external_id') source.row_data
    from jsonb_array_elements(p_rows) with ordinality source(row_data, row_number)
    order by source.row_data ->> 'external_id', source.row_number desc
  ) dedup;

  select count(*)::integer
  into new_count
  from pg_temp.topup_import_rows incoming
  left join public.distributors distributors on distributors.external_id = incoming.external_id
  where distributors.id is null;

  select count(*)::integer
  into reappear_count
  from pg_temp.topup_import_rows incoming
  join public.distributors distributors on distributors.external_id = incoming.external_id
  where normalized_period > coalesce(distributors.last_seen_period, date '-infinity');

  select count(*)::integer - reappear_count
  into update_count
  from pg_temp.topup_import_rows incoming
  join public.distributors distributors on distributors.external_id = incoming.external_id;

  select coalesce(profiles.full_name, profiles.email, 'Top Up administrator')
  into imported_by_name
  from public.profiles profiles
  where profiles.id = (select auth.uid());

  insert into public.imports (
    file_name,
    row_count,
    source_period,
    imported_by,
    imported_by_name,
    report_type,
    status
  )
  values (
    btrim(p_file_name),
    (select count(*) from pg_temp.topup_import_rows),
    normalized_period,
    (select auth.uid()),
    coalesce(imported_by_name, 'Top Up administrator'),
    normalized_report_type,
    'complete'
  )
  returning id into import_id;

  insert into public.distributors (
    external_id,
    name,
    email,
    phone,
    country,
    region,
    joined_at,
    current_rank,
    target_rank,
    gap_to_rank,
    is_new_distributor,
    is_rank_opportunity,
    is_pcm_opportunity,
    nearest_leader_name,
    highest_rank_name,
    first_time_at_rank,
    has_ten_pack,
    source_contacted_by,
    source_notes,
    source_period,
    source_file_name,
    source_import_id,
    first_seen_period,
    last_seen_period
  )
  select
    incoming.external_id,
    incoming.name,
    incoming.email,
    incoming.phone,
    incoming.country,
    incoming.region,
    incoming.joined_at,
    incoming.current_rank,
    incoming.target_rank,
    incoming.gap_to_rank,
    incoming.is_new_distributor,
    incoming.is_rank_opportunity,
    incoming.is_pcm_opportunity,
    incoming.nearest_leader_name,
    incoming.highest_rank_name,
    incoming.first_time_at_rank,
    incoming.has_ten_pack,
    incoming.source_contacted_by,
    incoming.source_notes,
    normalized_period,
    btrim(p_file_name),
    import_id,
    normalized_period,
    normalized_period
  from pg_temp.topup_import_rows incoming
  on conflict (external_id) do update
  set
    name = excluded.name,
    email = coalesce(nullif(excluded.email, ''), public.distributors.email),
    phone = coalesce(excluded.phone, public.distributors.phone),
    country = case when excluded.country = 'Unknown' then public.distributors.country else excluded.country end,
    region = coalesce(excluded.region, public.distributors.region),
    joined_at = coalesce(excluded.joined_at, public.distributors.joined_at),
    current_rank = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.current_rank
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.current_rank, public.distributors.current_rank)
      else public.distributors.current_rank
    end,
    target_rank = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.target_rank
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.target_rank, public.distributors.target_rank)
      else public.distributors.target_rank
    end,
    gap_to_rank = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.gap_to_rank
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.gap_to_rank, public.distributors.gap_to_rank)
      else public.distributors.gap_to_rank
    end,
    is_new_distributor = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.is_new_distributor
      when excluded.last_seen_period = public.distributors.last_seen_period then public.distributors.is_new_distributor or excluded.is_new_distributor
      else public.distributors.is_new_distributor
    end,
    is_rank_opportunity = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.is_rank_opportunity
      when excluded.last_seen_period = public.distributors.last_seen_period then public.distributors.is_rank_opportunity or excluded.is_rank_opportunity
      else public.distributors.is_rank_opportunity
    end,
    is_pcm_opportunity = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.is_pcm_opportunity
      when excluded.last_seen_period = public.distributors.last_seen_period then public.distributors.is_pcm_opportunity or excluded.is_pcm_opportunity
      else public.distributors.is_pcm_opportunity
    end,
    nearest_leader_name = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.nearest_leader_name
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.nearest_leader_name, public.distributors.nearest_leader_name)
      else public.distributors.nearest_leader_name
    end,
    highest_rank_name = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.highest_rank_name
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.highest_rank_name, public.distributors.highest_rank_name)
      else public.distributors.highest_rank_name
    end,
    first_time_at_rank = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.first_time_at_rank
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.first_time_at_rank, public.distributors.first_time_at_rank)
      else public.distributors.first_time_at_rank
    end,
    has_ten_pack = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.has_ten_pack
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.has_ten_pack, public.distributors.has_ten_pack)
      else public.distributors.has_ten_pack
    end,
    source_contacted_by = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.source_contacted_by
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.source_contacted_by, public.distributors.source_contacted_by)
      else public.distributors.source_contacted_by
    end,
    source_notes = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.source_notes
      when excluded.last_seen_period = public.distributors.last_seen_period then coalesce(excluded.source_notes, public.distributors.source_notes)
      else public.distributors.source_notes
    end,
    source_period = greatest(coalesce(public.distributors.source_period, excluded.source_period), excluded.source_period),
    source_file_name = case when excluded.last_seen_period >= coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.source_file_name else public.distributors.source_file_name end,
    source_import_id = case when excluded.last_seen_period >= coalesce(public.distributors.last_seen_period, date '-infinity') then excluded.source_import_id else public.distributors.source_import_id end,
    first_seen_period = least(coalesce(public.distributors.first_seen_period, excluded.first_seen_period), excluded.first_seen_period),
    last_seen_period = greatest(coalesce(public.distributors.last_seen_period, excluded.last_seen_period), excluded.last_seen_period),
    status = case
      when excluded.last_seen_period > coalesce(public.distributors.last_seen_period, date '-infinity')
        and public.distributors.status in ('contacted'::public.contact_status, 'complete'::public.contact_status)
        then 'follow-up'::public.contact_status
      else public.distributors.status
    end;

  insert into public.distributor_snapshots (
    distributor_id,
    period,
    current_rank,
    target_rank,
    gap_to_rank,
    is_new_distributor,
    is_rank_opportunity,
    is_pcm_opportunity,
    nearest_leader_name,
    highest_rank_name,
    first_time_at_rank,
    has_ten_pack,
    source_contacted_by,
    source_notes,
    source_file_name,
    import_id
  )
  select
    distributors.id,
    normalized_period,
    incoming.current_rank,
    incoming.target_rank,
    incoming.gap_to_rank,
    incoming.is_new_distributor,
    incoming.is_rank_opportunity,
    incoming.is_pcm_opportunity,
    incoming.nearest_leader_name,
    incoming.highest_rank_name,
    incoming.first_time_at_rank,
    incoming.has_ten_pack,
    incoming.source_contacted_by,
    incoming.source_notes,
    btrim(p_file_name),
    import_id
  from pg_temp.topup_import_rows incoming
  join public.distributors distributors on distributors.external_id = incoming.external_id
  on conflict (distributor_id, period) do update
  set
    current_rank = coalesce(excluded.current_rank, public.distributor_snapshots.current_rank),
    target_rank = coalesce(excluded.target_rank, public.distributor_snapshots.target_rank),
    gap_to_rank = coalesce(excluded.gap_to_rank, public.distributor_snapshots.gap_to_rank),
    is_new_distributor = public.distributor_snapshots.is_new_distributor or excluded.is_new_distributor,
    is_rank_opportunity = public.distributor_snapshots.is_rank_opportunity or excluded.is_rank_opportunity,
    is_pcm_opportunity = public.distributor_snapshots.is_pcm_opportunity or excluded.is_pcm_opportunity,
    nearest_leader_name = coalesce(excluded.nearest_leader_name, public.distributor_snapshots.nearest_leader_name),
    highest_rank_name = coalesce(excluded.highest_rank_name, public.distributor_snapshots.highest_rank_name),
    first_time_at_rank = coalesce(excluded.first_time_at_rank, public.distributor_snapshots.first_time_at_rank),
    has_ten_pack = coalesce(excluded.has_ten_pack, public.distributor_snapshots.has_ten_pack),
    source_contacted_by = coalesce(excluded.source_contacted_by, public.distributor_snapshots.source_contacted_by),
    source_notes = coalesce(excluded.source_notes, public.distributor_snapshots.source_notes),
    source_file_name = case
      when public.distributor_snapshots.source_file_name is null then excluded.source_file_name
      when public.distributor_snapshots.source_file_name = excluded.source_file_name then public.distributor_snapshots.source_file_name
      else public.distributor_snapshots.source_file_name || ', ' || excluded.source_file_name
    end,
    import_id = excluded.import_id,
    updated_at = now();

  return jsonb_build_object(
    'new_count', new_count,
    'update_count', greatest(update_count, 0),
    'reappear_count', reappear_count,
    'row_count', (select count(*) from pg_temp.topup_import_rows),
    'period', normalized_period,
    'import_id', import_id
  );
end;
$$;

revoke all on function public.import_report(jsonb, date, text, text) from public, anon, authenticated;
grant execute on function public.import_report(jsonb, date, text, text) to authenticated;

comment on table public.distributor_snapshots is
'One immutable-by-period source snapshot per distributor and report month. Work ownership and activity remain on distributors.';

comment on function public.import_report(jsonb, date, text, text) is
'Admin-only transactional report import. Deduplicates by distributor ID, preserves work state, records monthly snapshots, and returns non-overlapping counts.';
