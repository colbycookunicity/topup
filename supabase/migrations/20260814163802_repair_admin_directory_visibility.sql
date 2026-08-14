create policy "admins can view all admin records"
on public.topup_admins for select to authenticated
using ((select private.is_topup_admin()));

create or replace function private.sync_topup_directory_admin_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.topup_user_directory set is_admin = false where email = old.email;
    return old;
  end if;

  insert into public.topup_user_directory (email, display_name, is_admin)
  values (
    new.email,
    initcap(replace(split_part(new.email, '@', 1), '.', ' ')),
    true
  )
  on conflict (email) do update set is_admin = true;
  return new;
end;
$$;

revoke all on function private.sync_topup_directory_admin_role() from public, anon, authenticated;

insert into public.topup_user_directory (email, display_name, is_admin)
values ('sam.hughes@unicity.com', 'Sam Hughes', true)
on conflict (email) do update set is_admin = true;
