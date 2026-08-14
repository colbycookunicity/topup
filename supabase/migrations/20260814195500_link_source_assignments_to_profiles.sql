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
  where directory.email = lower(new.email)
    and (
      select count(*)
      from public.topup_user_directory peers
      where lower(trim(peers.display_name)) = lower(trim(directory.display_name))
    ) = 1;

  if directory_name is not null then
    update public.distributors
    set assigned_to = new.id,
        assigned_name = directory_name,
        status = case when status = 'unassigned' then 'assigned'::public.contact_status else status end
    where assigned_to is null
      and lower(trim(assigned_name)) = lower(trim(directory_name));
  end if;

  return new;
end;
$$;

revoke all on function private.link_source_assignments_to_profile() from public, anon, authenticated;

drop trigger if exists profiles_link_source_assignments on public.profiles;
create trigger profiles_link_source_assignments
after insert or update of email, full_name on public.profiles
for each row execute function private.link_source_assignments_to_profile();

with unique_directory_profiles as (
  select directory.display_name, profiles.id as profile_id
  from public.topup_user_directory directory
  join public.profiles profiles on lower(profiles.email) = directory.email
  where (
    select count(*)
    from public.topup_user_directory peers
    where lower(trim(peers.display_name)) = lower(trim(directory.display_name))
  ) = 1
)
update public.distributors distributors
set assigned_to = matches.profile_id,
    assigned_name = matches.display_name,
    status = case when distributors.status = 'unassigned' then 'assigned'::public.contact_status else distributors.status end
from unique_directory_profiles matches
where distributors.assigned_to is null
  and lower(trim(distributors.assigned_name)) = lower(trim(matches.display_name));

comment on function private.link_source_assignments_to_profile() is
'Links source-workbook ownership labels to the matching Top Up profile when the display name is unique.';
