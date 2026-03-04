-- Enable RLS on lookup tables that were missed in the initial schema
-- Both tables are read-only reference data; writes restricted to admin role

alter table opportunity_types  enable row level security;
alter table pipeline_statuses  enable row level security;

-- All authenticated users can read lookup data (needed for forms, filters, etc.)
create policy "Authenticated users can read opportunity types"
  on opportunity_types for select to authenticated using (true);

create policy "Authenticated users can read pipeline statuses"
  on pipeline_statuses for select to authenticated using (true);

-- Only admins can modify lookup tables (seeded data, rarely changed)
create policy "Admins can manage opportunity types"
  on opportunity_types for all to authenticated
  using     ((select role from profiles where id = auth.uid()) = 'admin')
  with check ((select role from profiles where id = auth.uid()) = 'admin');

create policy "Admins can manage pipeline statuses"
  on pipeline_statuses for all to authenticated
  using     ((select role from profiles where id = auth.uid()) = 'admin')
  with check ((select role from profiles where id = auth.uid()) = 'admin');
