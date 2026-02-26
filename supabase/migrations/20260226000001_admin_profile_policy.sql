-- ============================================================
-- Allow admins to update any user's profile (role management)
-- ============================================================

create policy "Admins can update any profile"
  on profiles for update to authenticated
  using (
    (select role from profiles where id = auth.uid()) = 'admin'
  )
  with check (
    (select role from profiles where id = auth.uid()) = 'admin'
  );
