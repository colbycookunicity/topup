create schema if not exists private;

create type public.contact_status as enum ('unassigned', 'assigned', 'contacted', 'follow-up', 'complete');
create type public.push_level as enum ('rank', 'pcm');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  market text default 'Americas',
  points integer not null default 0 check (points >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.distributors (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  name text not null,
  email text not null default '',
  phone text,
  country text not null default 'Unknown',
  region text,
  joined_at date,
  current_rank text not null default 'Distributor',
  target_rank text,
  ov numeric(14, 2) not null default 0 check (ov >= 0),
  gap_to_rank numeric(14, 2) not null default 0 check (gap_to_rank >= 0),
  status public.contact_status not null default 'unassigned',
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_name text,
  is_new_distributor boolean not null default false,
  push_level public.push_level,
  last_contacted_at timestamptz,
  last_outcome text,
  notes text,
  priority_score integer not null default 50 check (priority_score between 0 and 100),
  source_import_id uuid,
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
  points_awarded integer not null default 10 check (points_awarded >= 0),
  created_at timestamptz not null default now()
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  row_count integer not null default 0 check (row_count >= 0),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'complete' check (status in ('processing', 'complete', 'failed')),
  created_at timestamptz not null default now()
);

alter table public.distributors
  add constraint distributors_source_import_id_fkey
  foreign key (source_import_id) references public.imports(id) on delete set null;

create index distributors_status_idx on public.distributors(status);
create index distributors_assigned_to_idx on public.distributors(assigned_to);
create index distributors_priority_idx on public.distributors(priority_score desc);
create index distributors_push_level_idx on public.distributors(push_level) where push_level is not null;
create index activities_distributor_created_idx on public.activities(distributor_id, created_at desc);
create index activities_user_created_idx on public.activities(user_id, created_at desc);

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
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'topup_role', '') = 'admin';
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
  and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "employees can update their own profile"
on public.profiles for update to authenticated
using ((select private.is_unicity_employee()) and id = (select auth.uid()))
with check ((select private.is_unicity_employee()) and id = (select auth.uid()));

create policy "employees can view distributors"
on public.distributors for select to authenticated
using ((select private.is_unicity_employee()));

create policy "admins can create distributor records"
on public.distributors for insert to authenticated
with check ((select private.is_topup_admin()));

create policy "owners can update their distributor records"
on public.distributors for update to authenticated
using (
  (select private.is_unicity_employee())
  and ((select private.is_topup_admin()) or assigned_to is null or assigned_to = (select auth.uid()))
)
with check (
  (select private.is_unicity_employee())
  and ((select private.is_topup_admin()) or assigned_to = (select auth.uid()))
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
    select 1 from public.distributors d
    where d.id = distributor_id
      and (d.assigned_to = (select auth.uid()) or (select private.is_topup_admin()))
  )
);

create policy "admins can view import history"
on public.imports for select to authenticated
using ((select private.is_topup_admin()));

create policy "admins can create imports"
on public.imports for insert to authenticated
with check ((select private.is_topup_admin()) and imported_by = (select auth.uid()));

revoke all on table public.profiles, public.distributors, public.activities, public.imports from anon;
grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.distributors to authenticated;
grant select, insert on table public.activities to authenticated;
grant select, insert on table public.imports to authenticated;
grant execute on function private.is_unicity_employee() to authenticated;
grant execute on function private.is_topup_admin() to authenticated;
revoke execute on function private.set_updated_at() from public, anon, authenticated;
