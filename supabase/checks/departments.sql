-- Departments, space access by department and person, and the welcome step's self-join
-- (20261110000000_departments, 20261110000100_department_self_join, 20261116000100_welcome_once). Runs in one transaction and
-- rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/departments.sql
--
-- On a database where the two migrations haven't run yet, add `-v unapplied=1` to run them inside
-- the transaction first. Needs the shell migrations before them (a started local Supabase has them).
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;
\if :{?unapplied}
\ir ../migrations/20261110000000_departments.sql
\ir ../migrations/20261110000100_department_self_join.sql
\ir ../migrations/20261116000100_welcome_once.sql
\endif

-- Seven people: an owner, an admin, two members, one member the welcome step will place, one who
-- has no tier yet, and one the app has not let in.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner@dept.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'admin@dept.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'one@dept.test',     now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 'two@dept.test',     now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 'new@dept.test',     now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c6', 'pending@dept.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c7', 'stranger@dept.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000000c1';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@dept.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@dept.test';
update app.app_user set tier = 'member', status = 'active' where email in ('one@dept.test', 'two@dept.test', 'new@dept.test');
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000000c6', 'member');

-- Three spaces and the departments: Sales is named on a rule that leaves admins out, Support on one
-- that lets them in, Ops on none.
insert into miso.spaces (id, slug, name) values ('dept-a', 'dept-a', 'A'), ('dept-b', 'dept-b', 'B'), ('dept-c', 'dept-c', 'C');
insert into miso.departments (id, name) values
  ('00000000-0000-0000-0000-00000000d001', 'Sales'),
  ('00000000-0000-0000-0000-00000000d002', 'Support'),
  ('00000000-0000-0000-0000-00000000d003', 'Ops');
insert into miso.space_access (space_id, tiers, departments, people) values
  ('dept-a', '{admin}',  '{00000000-0000-0000-0000-00000000d002}', '{}'),
  ('dept-b', '{member}', '{00000000-0000-0000-0000-00000000d001}', '{}'),
  ('dept-c', '{}',       '{}', '{00000000-0000-0000-0000-0000000000c4}');
insert into miso.department_members (department_id, user_id) values
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000c3');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'ok   ' else 'FAIL ' end || label $$;
-- Runs a statement as the current role: "refused" for an error, else the rows it touched.
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
exception when others then return 'refused';
end $$;

-- Who sees what: a department, a person, and the tier by itself.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok('a member in the department sees the space its rule names', miso.sees_space('dept-a'));
select pg_temp.ok('a member not named sees nothing of a person-only space', not miso.sees_space('dept-c'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c4');
select pg_temp.ok('a member outside the department does not see the space', not miso.sees_space('dept-a'));
select pg_temp.ok('a person named on a rule sees its space, whatever their tier', miso.sees_space('dept-c'));
reset role;
update app.app_user set status = 'suspended' where email = 'one@dept.test';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok('a suspended person in the department does not see the space', not miso.sees_space('dept-a'));
reset role;
update app.app_user set status = 'active' where email = 'one@dept.test';

-- The rules as the API reads them: the old columns first, then departments, people and `members`.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok('space_access_rules() lists the people a department brings in',
  (select members from miso.space_access_rules() where space_id = 'dept-a') = '{00000000-0000-0000-0000-0000000000c3}');
select pg_temp.ok('space_access_rules() lists a named person',
  (select members from miso.space_access_rules() where space_id = 'dept-c') = '{00000000-0000-0000-0000-0000000000c4}');
select pg_temp.ok('space_access_rules() still starts with space_id and tiers',
  (select array_agg(a.attname order by a.attnum) from pg_proc p, unnest(p.proargnames) with ordinality as a(attname, attnum)
    where p.oid = 'miso.space_access_rules()'::regprocedure and a.attnum between 1 and 2) = '{space_id,tiers}');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c7');
select pg_temp.ok('someone the app has not let in cannot read the rules', pg_temp.try('select * from miso.space_access_rules()') = 'refused');
reset role;

-- Who changes departments.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
select pg_temp.ok('a member cannot add a department', pg_temp.try($$insert into miso.departments (name) values ('Nope')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select pg_temp.ok('an admin adds a department', pg_temp.try($$insert into miso.departments (name) values ('Legal')$$) = '1');
select pg_temp.ok('an admin renames any department', pg_temp.try($$update miso.departments set name = 'Support team' where name = 'Support'$$) = '1');
select pg_temp.ok('an admin puts someone in a department that no hidden rule names',
  pg_temp.try($$insert into miso.department_members values ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000c4')$$) = '1');
select pg_temp.ok('an admin cannot put someone in a department that opens a space admins do not see',
  pg_temp.try($$insert into miso.department_members values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000c4')$$) = 'refused');
select pg_temp.ok('an admin cannot delete that department either', pg_temp.try($$delete from miso.departments where id = '00000000-0000-0000-0000-00000000d001'$$) = '0');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select pg_temp.ok('an owner puts someone in it', pg_temp.try($$insert into miso.department_members values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000c4')$$) = '1');
select pg_temp.ok('an owner deletes a department', pg_temp.try($$delete from miso.departments where id = '00000000-0000-0000-0000-00000000d002'$$) = '1');
reset role;
select pg_temp.ok('a deleted department leaves no id in the rules that named it',
  (select departments from miso.space_access where space_id = 'dept-a') = '{}');

-- The welcome step.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
select pg_temp.ok('welcome_self refuses an account with no tier', pg_temp.try($$select miso.welcome_self('Pending', '{}')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c5');
select pg_temp.ok('welcome_self refuses an empty name', pg_temp.try($$select miso.welcome_self('   ', '{}')$$) = 'refused');
select pg_temp.ok('welcome_self refuses an unknown department',
  pg_temp.try($$select miso.welcome_self('New', '{00000000-0000-0000-0000-00000000dead}')$$) = 'refused');
select pg_temp.ok('welcome_self refuses a department that opens a space admins do not see',
  pg_temp.try($$select miso.welcome_self('New', '{00000000-0000-0000-0000-00000000d001}')$$) = 'refused');
select pg_temp.ok('welcome_self refuses more than 20 departments',
  pg_temp.try($$select miso.welcome_self('New', (select array_agg(gen_random_uuid()) from generate_series(1, 21)))$$) = 'refused');
select pg_temp.ok('a refused call changed nothing', (select display_name from app.app_user where user_id = auth.uid()) is null);
select pg_temp.ok('welcome_self joins the first time', miso.welcome_self('  New Person ', '{00000000-0000-0000-0000-00000000d003}'));
select pg_temp.ok('and trims the name', (select display_name from app.app_user where user_id = auth.uid()) = 'New Person');
select pg_temp.ok('the second call joins nothing more', not miso.welcome_self('New Person', '{00000000-0000-0000-0000-00000000d003}'));
reset role;
select pg_temp.ok('the person is in exactly the one department',
  (select count(*) from miso.department_members where user_id = '00000000-0000-0000-0000-0000000000c5') = 1);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c5');
select pg_temp.ok('a member cannot join a department with a plain insert',
  pg_temp.try($$insert into miso.department_members values ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000c5')$$) = 'refused');
select pg_temp.ok('a member cannot mark or unmark themself as welcomed',
  pg_temp.try($$update app.app_user set welcomed_at = null where user_id = auth.uid()$$) = 'refused');
reset role;

-- Welcomed once, for good (20261116000100_welcome_once).
select pg_temp.ok('joining marks the account welcomed',
  (select welcomed_at from app.app_user where user_id = '00000000-0000-0000-0000-0000000000c5') is not null);
select pg_temp.ok('an admin placing someone marks them welcomed too',
  (select welcomed_at from app.app_user where user_id = '00000000-0000-0000-0000-0000000000c3') is not null);
delete from miso.department_members where user_id = '00000000-0000-0000-0000-0000000000c5';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c5');
select pg_temp.ok('emptied by an admin, welcome_self joins nothing',
  not miso.welcome_self('New Person', '{00000000-0000-0000-0000-00000000d003}'));
reset role;
select pg_temp.ok('and the person stays in no department',
  not exists (select 1 from miso.department_members where user_id = '00000000-0000-0000-0000-0000000000c5'));
-- A name-only welcome uses up the self-join: departments picked later join nothing.
update app.app_user set tier = 'member', status = 'active', welcomed_at = null where email = 'pending@dept.test';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c6');
select pg_temp.ok('a name-only welcome joins nothing', not miso.welcome_self('Late Person', '{}'));
select pg_temp.ok('and marks the account welcomed', (select welcomed_at from app.app_user where user_id = auth.uid()) is not null);
select pg_temp.ok('departments sent later join nothing',
  not miso.welcome_self('Late Person', '{00000000-0000-0000-0000-00000000d003}'));
reset role;
select pg_temp.ok('so that person is in no department',
  not exists (select 1 from miso.department_members where user_id = '00000000-0000-0000-0000-0000000000c6'));
select pg_temp.ok('members have no grant on welcomed_at',
  not has_column_privilege('authenticated', 'app.app_user', 'welcomed_at', 'UPDATE'));
rollback;
