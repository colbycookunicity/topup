create or replace function private.sync_topup_directory_display_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set full_name = new.display_name
  where lower(email) = new.email;

  update public.distributors
  set assigned_name = new.display_name
  where assigned_to in (
    select id from public.profiles where lower(email) = new.email
  );

  return new;
end;
$$;

revoke all on function private.sync_topup_directory_display_name() from public, anon, authenticated;