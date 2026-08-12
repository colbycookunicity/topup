create table public.topup_user_directory (
  email text primary key check (email = lower(email) and email like '%@unicity.com'),
  display_name text not null check (length(trim(display_name)) > 0),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger topup_user_directory_set_updated_at
before update on public.topup_user_directory
for each row execute function private.set_updated_at();

alter table public.topup_user_directory enable row level security;

create policy "admins can view all admin records"
on public.topup_admins for select to authenticated
using ((select private.is_topup_admin()));

create policy "employees can view their directory entry"
on public.topup_user_directory for select to authenticated
using (
  (select private.is_unicity_employee())
  and (email = lower(coalesce((select auth.jwt()) ->> 'email', '')) or (select private.is_topup_admin()))
);

create policy "admins can update user display names"
on public.topup_user_directory for update to authenticated
using ((select private.is_topup_admin()))
with check ((select private.is_topup_admin()) and email = lower(email) and email like '%@unicity.com' and length(trim(display_name)) > 0);

drop policy if exists "employees can update their own profile" on public.profiles;
create policy "admins can update profile display names"
on public.profiles for update to authenticated
using ((select private.is_topup_admin()))
with check ((select private.is_topup_admin()));

revoke all on table public.topup_user_directory from anon, authenticated;
grant select, update (display_name) on table public.topup_user_directory to authenticated;
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

insert into public.topup_user_directory (email, display_name)
values
  ('alexandra.rodriguez@unicity.com', 'Alexa'),
  ('chaimae.saidi@unicity.com', 'Chaimae'),
  ('jose.orozco@unicity.com', 'Pablo'),
  ('carolina.martinez@unicity.com', 'Caro'),
  ('alexander.velandia@unicity.com', 'Alex V'),
  ('angelie.gonzalez@unicity.com', 'Angelie'),
  ('colby.cook@unicity.com', 'Colby')
on conflict (email) do update set display_name = excluded.display_name;

insert into public.topup_admins (email) values ('carolina.martinez@unicity.com')
on conflict (email) do nothing;

update public.profiles profiles
set full_name = directory.display_name
from public.topup_user_directory directory
where lower(profiles.email) = directory.email and profiles.full_name is distinct from directory.display_name;

comment on table public.topup_user_directory is
'Protected Top Up identity directory. The OTP service records successful logins; administrators may edit display names only.';