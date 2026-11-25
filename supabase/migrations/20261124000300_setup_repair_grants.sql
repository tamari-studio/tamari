-- The secret key can reach app.app_user, so scripts/supabase-setup.ts can repair a service account.
--
-- The secret key runs as service_role. The shell gave service_role the miso schema but not app, so
-- the setup's repair path (drop the app.app_user row of an account that exists but isn't set up)
-- failed with "permission denied for schema app". It runs when a first setup was cut off after
-- the account was made and before its members row was written, or for an account the broker made
-- before the setup ran. Only that one statement needs it: select (for its where) and delete.

grant usage on schema app to service_role;
grant select, delete on app.app_user to service_role;
