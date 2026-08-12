drop policy if exists "employees can view available or owned distributors" on public.distributors;
drop policy if exists "employees can view distributors" on public.distributors;

create policy "employees can view all distributors"
on public.distributors for select to authenticated
using ((select private.is_unicity_employee()));

drop policy if exists "employees can view activity for available or owned distributors" on public.activities;
drop policy if exists "employees can view team activity" on public.activities;

create policy "employees can view all team activity"
on public.activities for select to authenticated
using ((select private.is_unicity_employee()));

drop policy if exists "owners can log activity" on public.activities;

create policy "employees can add team activity"
on public.activities for insert to authenticated
with check (
  (select private.is_unicity_employee())
  and user_id = (select auth.uid())
  and exists (
    select 1
    from public.distributors distributors
    where distributors.id = distributor_id
  )
);

comment on policy "employees can view all distributors"
on public.distributors is
'Verified Unicity employees can browse the shared distributor directory. Exclusive ownership is enforced separately by the update policy.';

comment on policy "employees can view all team activity"
on public.activities is
'Verified Unicity employees and administrators share one readable activity history.';

comment on policy "employees can add team activity"
on public.activities is
'Any verified Unicity employee can add attributed context to any distributor without changing ownership.';