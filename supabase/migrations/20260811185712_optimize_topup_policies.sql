create index if not exists distributors_source_import_id_idx
    on public.distributors(source_import_id);
  create index if not exists imports_imported_by_idx
    on public.imports(imported_by);

  drop policy if exists "employees can create their own profile" on public.profiles;
  create policy "employees can create their own profile"
  on public.profiles for insert to authenticated
  with check (
    (select private.is_unicity_employee())
    and id = (select auth.uid())
    and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

  drop policy if exists "employees can update their own profile" on public.profiles;
  create policy "employees can update their own profile"
  on public.profiles for update to authenticated
  using ((select private.is_unicity_employee()) and id = (select auth.uid()))
  with check (
    (select private.is_unicity_employee())
    and id = (select auth.uid())
    and lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

  drop policy if exists "employees can verify their own admin record" on public.topup_admins;
  create policy "employees can verify their own admin record"
  on public.topup_admins for select to authenticated
  using (
    (select private.is_unicity_employee())
    and email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );