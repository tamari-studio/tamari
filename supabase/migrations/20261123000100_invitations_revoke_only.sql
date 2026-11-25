-- Revoking an invite can't be undone (follows 20261123000000_invitations). The update policy let an
-- admin set revoked_at back to null, reopening an invite, including an owner invite that only an
-- owner could have made. Now an update reaches only an open invite and must leave it revoked.
--
-- Only alters one policy's expressions; nothing is dropped.

SET LOCAL lock_timeout = '10s';

alter policy invitations_update_admin on miso.invitations
  using (miso.is_member() and app.has_at_least('admin'::app.tier) and accepted_at is null and revoked_at is null)
  with check (miso.is_member() and app.has_at_least('admin'::app.tier) and revoked_at is not null);
