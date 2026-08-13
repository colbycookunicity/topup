create policy "admins can add Top Up administrators"
on public.topup_admins for insert to authenticated
with check (
  (select private.is_topup_admin())
  and email = lower(email)
  and email like '%@unicity.com'
);

grant insert on table public.topup_admins to authenticated;

create function private.sync_topup_directory_admin_role()
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

  update public.topup_user_directory set is_admin = true where email = new.email;
  return new;
end;
$$;

revoke all on function private.sync_topup_directory_admin_role() from public, anon, authenticated;

create trigger topup_admins_sync_directory_role
after insert or delete on public.topup_admins
for each row execute function private.sync_topup_directory_admin_role();

insert into public.topup_admins (email)
values ('sam.hughes@unicity.com')
on conflict (email) do nothing;

update public.topup_user_directory
set is_admin = true
where email = 'sam.hughes@unicity.com';
