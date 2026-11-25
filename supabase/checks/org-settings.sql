-- Organisation settings (20261116000300_org_settings, 20261122000100_org_name): every member reads
-- the one row, only admins and owners change its look or workspace name. Runs in one transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/org-settings.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

-- The owner first: on a fresh database the first account becomes the owner, and the last owner
-- can't be demoted.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a0', 'owner@org.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000006a1', 'admin@org.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000006a2', 'member@org.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000006a3', 'nobody@org.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000006a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@org.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@org.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@org.test';

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'ok   ' else 'FAIL ' end || label $$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
exception when others then return 'refused';
end $$;

select pg_temp.ok('there is exactly one row', (select count(*) from miso.org_settings) = 1);
select pg_temp.ok('a second row is refused', pg_temp.try($$insert into miso.org_settings (id) values (false)$$) = 'refused');

select pg_temp.as_user('00000000-0000-0000-0000-0000000006a2');
select pg_temp.ok('a member reads the look', (select count(*) from miso.org_settings) = 1);
select pg_temp.ok('a member cannot change it', pg_temp.try($$update miso.org_settings set theme = '{"font":"serif"}'$$) = '0');
select pg_temp.ok('a member cannot set the workspace name', pg_temp.try($$update miso.org_settings set name = 'Acme'$$) = '0');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a3');
select pg_temp.ok('someone the app has not let in reads nothing', (select count(*) from miso.org_settings) = 0);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000006a1');
select pg_temp.ok('an admin changes it', pg_temp.try($$update miso.org_settings set theme = '{"font":"serif"}'$$) = '1');
select pg_temp.ok('but not to something that is not an object', pg_temp.try($$update miso.org_settings set theme = '[]'$$) = 'refused');
select pg_temp.ok('an admin sets the workspace name', pg_temp.try($$update miso.org_settings set name = 'Acme'$$) = '1');
select pg_temp.ok('but not over 60 characters', pg_temp.try($$update miso.org_settings set name = repeat('x', 61)$$) = 'refused');
select pg_temp.ok('nor an empty one', pg_temp.try($$update miso.org_settings set name = ''$$) = 'refused');
select pg_temp.ok('nor only spaces', pg_temp.try($$update miso.org_settings set name = '   '$$) = 'refused');
reset role;
select pg_temp.ok('the change is there', (select theme ->> 'font' from miso.org_settings) = 'serif');
select pg_temp.ok('the name is there', (select name from miso.org_settings) = 'Acme');
rollback;
