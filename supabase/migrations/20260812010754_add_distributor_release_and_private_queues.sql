drop policy if exists "employees can view distributors" on public.distributors;

create policy "employees can view available or owned distributors"
on public.distributors for select to authenticated
using (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or (assigned_to is null and assigned_name is null)
    or assigned_to = (select auth.uid())
  )
);

drop policy if exists "owners and admins can update distributor records" on public.distributors;

create policy "owners and admins can update distributor records"
on public.distributors for update to authenticated
using (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or (assigned_to is null and assigned_name is null)
    or assigned_to = (select auth.uid())
  )
)
with check (
  (select private.is_unicity_employee())
  and (
    (select private.is_topup_admin())
    or assigned_to = (select auth.uid())
    or (
      assigned_to is null
      and assigned_name is null
      and status = 'unassigned'
    )
  )
);

drop policy if exists "employees can view team activity" on public.activities;

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
        or (distributors.assigned_to is null and distributors.assigned_name is null)
        or distributors.assigned_to = (select auth.uid())
      )
  )
);

comment on policy "employees can view available or owned distributors"
on public.distributors is
'Employees can discover unclaimed work and see their own active queue. Administrators retain the full team view.';

comment on policy "employees can view activity for available or owned distributors"
on public.activities is
'Activity notes remain with the distributor after release and become visible to the next permitted owner.';