create schema if not exists private;

create type public.contact_status as enum ('unassigned', 'assigned', 'contacted', 'follow-up', 'complete');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  market text default 'Americas',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.topup_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  row_count integer not null default 0 check (row_count >= 0),
  source_period date,
  imported_by uuid references public.profiles(id) on delete set null,
  imported_by_name text,
  status text not null default 'complete' check (status in ('processing', 'complete', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table public.distributors (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique check (external_id ~ '^[0-9]+$'),
  name text not null check (length(trim(name)) > 0),
  email text not null default '',
  phone text,
  country text not null default 'Unknown',
  region text,
  joined_at date,
  current_rank text,
  target_rank text,
  gap_to_rank numeric(14, 2) check (gap_to_rank is null or gap_to_rank >= 0),
  status public.contact_status not null default 'unassigned',
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_name text,
  source_contacted_by text,
  is_new_distributor boolean not null default false,
  is_rank_opportunity boolean not null default false,
  is_pcm_opportunity boolean not null default false,
  nearest_leader_name text,
  highest_rank_name text,
  first_time_at_rank boolean,
  has_ten_pack boolean,
  source_notes text,
  source_period date,
  source_file_name text,
  last_contacted_at timestamptz,
  last_outcome text,
  notes text,
  source_import_id uuid references public.imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.distributors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  activity_type text not null,
  outcome text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index distributors_status_idx on public.distributors(status);
create index distributors_assigned_to_idx on public.distributors(assigned_to);
create index distributors_source_import_id_idx on public.distributors(source_import_id);
create index distributors_source_period_idx on public.distributors(source_period);
create index distributors_rank_opportunity_idx on public.distributors(is_rank_opportunity) where is_rank_opportunity;
create index distributors_pcm_opportunity_idx on public.distributors(is_pcm_opportunity) where is_pcm_opportunity;
create index distributors_new_distributor_idx on public.distributors(is_new_distributor) where is_new_distributor;
create index activities_distributor_created_idx on public.activities(distributor_id, created_at desc);
create index activities_user_created_idx on public.activities(user_id, created_at desc);
create index imports_imported_by_idx on public.imports(imported_by);

create function private.is_unicity_employee()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@unicity.com';
$$;

create function private.is_topup_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.topup_admins admins
    where admins.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();

create trigger distributors_set_updated_at before update on public.distributors
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.topup_admins enable row level security;
alter table public.distributors enable row level security;
alter table public.activities enable row level security;
alter table public.imports enable row level security;

create policy "employees can view profiles"
on public.profiles for select to authenticated
using ((select private.is_unicity_employee()));

create policy "employees can create their own profile"
on public.profiles for insert to authenticated
with check (
  (select private.is_unicity_employee())
  and id = (select auth.uid())
  and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "employees can update their own profile"
on public.profiles for update to authenticated
using ((select private.is_unicity_employee()) and id = (select auth.uid()))
with check (
  (select private.is_unicity_employee())
  and id = (select auth.uid())
  and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "employees can verify their own admin record"
on public.topup_admins for select to authenticated
using (
  (select private.is_unicity_employee())
  and email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

create policy "employees can view distributors"
on public.distributors for select to authenticated
using ((select private.is_unicity_employee()));

create policy "admins can create distributor records"
on public.distributors for insert to authenticated
with check ((select private.is_topup_admin()));

create policy "owners and admins can update distributor records"
on public.distributors for update to authenticated
using (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or assigned_to is null
    or assigned_to = (select auth.uid())
  )
)
with check (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or assigned_to = (select auth.uid())
  )
);

create policy "admins can remove distributor records"
on public.distributors for delete to authenticated
using ((select private.is_topup_admin()));

create policy "employees can view team activity"
on public.activities for select to authenticated
using ((select private.is_unicity_employee()));

create policy "owners can log activity"
on public.activities for insert to authenticated
with check (
  (select private.is_unicity_employee())
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.distributors distributors
    where distributors.id = distributor_id
      and (
        distributors.assigned_to = (select auth.uid())
        or (select private.is_topup_admin())
      )
  )
);

create policy "admins can view import history"
on public.imports for select to authenticated
using ((select private.is_topup_admin()));

create policy "admins can create imports"
on public.imports for insert to authenticated
with check (
  (select private.is_topup_admin())
  and imported_by = (select auth.uid())
);

revoke all on schema private from public, anon;
revoke all on table public.profiles, public.topup_admins, public.distributors, public.activities, public.imports from anon, authenticated;
revoke execute on function private.is_unicity_employee(), private.is_topup_admin(), private.set_updated_at() from public, anon, authenticated;

grant usage on schema public, private to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select on table public.topup_admins to authenticated;
grant select, insert, update, delete on table public.distributors to authenticated;
grant select, insert on table public.activities to authenticated;
grant select, insert on table public.imports to authenticated;
grant execute on function private.is_unicity_employee(), private.is_topup_admin() to authenticated;
