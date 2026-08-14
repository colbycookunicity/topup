-- Avoid recursive RLS evaluation when distributor policies check admin status.
-- The helper must bypass topup_admins policies while performing its lookup.
create or replace function private.is_topup_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.topup_admins admins
    where admins.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function private.is_topup_admin() from public, anon, authenticated;
grant execute on function private.is_topup_admin() to authenticated;
