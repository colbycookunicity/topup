create policy "employees can update their own display name"
on public.topup_user_directory for update to authenticated
using ((select private.is_unicity_employee()) and email = lower(coalesce((select auth.jwt()) ->> 'email', '')))
with check ((select private.is_unicity_employee()) and email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and email = lower(email) and email like '%@unicity.com' and length(trim(display_name)) between 1 and 80);

create or replace function private.sync_topup_directory_display_name()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set full_name = new.display_name where lower(email) = new.email;
  return new;
end;
$$;

revoke all on function private.sync_topup_directory_display_name() from public, anon, authenticated;
create trigger topup_user_directory_sync_profile_name after update of display_name on public.topup_user_directory
for each row execute function private.sync_topup_directory_display_name();
comment on policy "employees can update their own display name" on public.topup_user_directory is
'Verified employees may edit only the display_name column on the directory row matching their authenticated email.';
