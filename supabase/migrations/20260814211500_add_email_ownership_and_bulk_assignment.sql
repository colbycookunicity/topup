alter table public.distributors
add column if not exists assigned_email text;

alter table public.distributors
drop constraint if exists distributors_assigned_email_lowercase;

alter table public.distributors
add constraint distributors_assigned_email_lowercase
check (assigned_email is null or assigned_email = lower(assigned_email));

create index if not exists distributors_assigned_email_idx
on public.distributors (assigned_email)
where assigned_email is not null;

with unique_directory_names as (
  select min(email) as email, lower(trim(display_name)) as normalized_name
  from public.topup_user_directory
  group by lower(trim(display_name))
  having count(*) = 1
)
update public.distributors distributors
set assigned_email = directory.email,
    status = case when distributors.status = 'unassigned' then 'assigned'::public.contact_status else distributors.status end
from unique_directory_names directory
where distributors.assigned_email is null
  and distributors.assigned_to is null
  and lower(trim(distributors.assigned_name)) = directory.normalized_name;

update public.distributors distributors
set assigned_email = lower(profiles.email)
from public.profiles profiles
where distributors.assigned_to = profiles.id
  and distributors.assigned_email is distinct from lower(profiles.email);

create or replace function private.link_source_assignments_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  directory_name text;
begin
  select directory.display_name
  into directory_name
  from public.topup_user_directory directory
  where directory.email = lower(new.email);

  update public.distributors
  set assigned_to = new.id,
      assigned_email = lower(new.email),
      assigned_name = coalesce(directory_name, assigned_name),
      status = case when status = 'unassigned' then 'assigned'::public.contact_status else status end
  where assigned_to is null
    and (
      assigned_email = lower(new.email)
      or (
        assigned_email is null
        and directory_name is not null
        and lower(trim(assigned_name)) = lower(trim(directory_name))
        and (
          select count(*)
          from public.topup_user_directory peers
          where lower(trim(peers.display_name)) = lower(trim(directory_name))
        ) = 1
      )
    );

  return new;
end;
$$;

drop policy if exists "employees can view available or owned distributors" on public.distributors;
create policy "employees can view available or owned distributors"
on public.distributors for select to authenticated
using (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or (assigned_to is null and assigned_email is null and assigned_name is null)
    or assigned_to = (select auth.uid())
    or assigned_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  )
);

drop policy if exists "owners and admins can update distributor records" on public.distributors;
create policy "owners and admins can update distributor records"
on public.distributors for update to authenticated
using (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or (assigned_to is null and assigned_email is null and assigned_name is null)
    or assigned_to = (select auth.uid())
    or assigned_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  )
)
with check (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or assigned_to = (select auth.uid())
    or assigned_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or (
      assigned_to is null
      and assigned_email is null
      and assigned_name is null
      and status = 'unassigned'
    )
  )
);

drop policy if exists "employees can view activity for available or owned distributors" on public.activities;
create policy "employees can view activity for available or owned distributors"
on public.activities for select to authenticated
using (
  (select private.is_unicity_employee())
  and exists (
    select 1
    from public.distributors distributors
    where distributors.id = activities.distributor_id
      and (
        (select private.is_topup_admin())
        or (distributors.assigned_to is null and distributors.assigned_email is null and distributors.assigned_name is null)
        or distributors.assigned_to = (select auth.uid())
        or distributors.assigned_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
      )
  )
);

grant update (assigned_email) on table public.distributors to authenticated;

comment on column public.distributors.assigned_email is
'Stable ownership key that connects preassigned distributors before a teammate first signs in.';
