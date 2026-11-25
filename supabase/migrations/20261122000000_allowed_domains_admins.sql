-- Admins and owners list the email domains whose new sign-ups get in as members (People & access,
-- /api/allowed-domains). The shell's "admins manage domains" policy checks the old miso.members
-- role, so an owner of the app tier was refused; these add the app-tier check the newer tables use.
-- The old policies stay: an org's database doesn't roll back with the shell.
create policy allowed_domains_select_admin on miso.allowed_domains as permissive for select to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier));
create policy allowed_domains_insert_admin on miso.allowed_domains as permissive for insert to authenticated
  with check (miso.is_member() and app.has_at_least('admin'::app.tier));
create policy allowed_domains_delete_admin on miso.allowed_domains as permissive for delete to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier));
