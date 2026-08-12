alter table public.topup_user_directory
add column is_admin boolean not null default false;

update public.topup_user_directory directory
set is_admin = exists (
  select 1 from public.topup_admins admins where admins.email = directory.email
);

drop policy if exists "admins can view all admin records" on public.topup_admins;

comment on column public.topup_user_directory.is_admin is
'Cached display role maintained by the secure OTP service; topup_admins remains the authorization source of truth.';