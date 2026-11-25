-- Only admins and owners create, change or delete connectors. Everyone who can use the app still
-- reads them (never their values): the Connectors page lists them, and the vault account reads them
-- to build space code's env.
drop policy "members use connectors" on miso.connectors;
create policy "members read connectors" on miso.connectors as permissive for select to authenticated
  using (miso.is_member());
create policy "admins insert connectors" on miso.connectors as permissive for insert to authenticated
  with check (miso.is_member() and app.has_at_least('admin'::app.tier));
create policy "admins update connectors" on miso.connectors as permissive for update to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier))
  with check (miso.is_member() and app.has_at_least('admin'::app.tier));
create policy "admins delete connectors" on miso.connectors as permissive for delete to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier));
