-- Subspaces (20261116000200_subspaces): only owners see, make and delete them. Runs in one
-- transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/subspaces.sql
--
-- On a database where the migration hasn't run yet, add `-v unapplied=1` to run it inside the
-- transaction first.
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;
\if :{?unapplied}
\ir ../migrations/20261116000200_subspaces.sql
\endif

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000005b1', 'owner@sub.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000005b2', 'admin@sub.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000005b3', 'member@sub.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000005b1';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@sub.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@sub.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@sub.test';

-- A top-level space everyone sees, one with a slug that would make a child land on a shell page,
-- and a widgets tab on the first.
insert into miso.spaces (id, slug, name, theme) values ('sub-top', 'subtop', 'Top', '{"color": "green"}'), ('sub-shared', 'shared', 'Shared', '{}');
insert into miso.tabs (space_id, ref) values ('sub-top', 'widgets');

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

-- Who makes one.
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b2');
select pg_temp.ok('an admin cannot make a subspace', pg_temp.try($$select miso.create_subspace('sub-top', 'Nope')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select pg_temp.ok('an owner makes a subspace', pg_temp.try($$select miso.create_subspace('sub-top', '  Hiring & Onboarding ')$$) = '1');
select pg_temp.ok('a second one with the same name gets its own slug', pg_temp.try($$select miso.create_subspace('sub-top', 'Hiring & onboarding')$$) = '1');
select pg_temp.ok('a name that is only spaces is refused', pg_temp.try($$select miso.create_subspace('sub-top', '   ')$$) = 'refused');
select pg_temp.ok('a subspace of a subspace is refused',
  pg_temp.try($$select miso.create_subspace((select id from miso.spaces where slug = 'subtop-hiring-onboarding'), 'Deeper')$$) = 'refused');
select pg_temp.ok('a child never takes a shell page''s address', (miso.create_subspace('sub-shared', 'Data')).slug = 'shared-data-2');
select pg_temp.ok('a child can have the same tab as its parent',
  pg_temp.try($$insert into miso.tabs (space_id, ref) select id, 'widgets' from miso.spaces where slug = 'subtop-hiring-onboarding'$$) = '1');
reset role;
select pg_temp.ok('the slugs are the parent''s and the name''s',
  (select array_agg(slug order by slug) from miso.spaces where parent_id = 'sub-top') = '{subtop-hiring-onboarding,subtop-hiring-onboarding-2}');
select pg_temp.ok('a child takes its parent''s theme and no folder',
  (select bool_and(theme = '{"color": "green"}'::jsonb and folder is null) from miso.spaces where parent_id = 'sub-top'));
select pg_temp.ok('and a trimmed name', (select name from miso.spaces where slug = 'subtop-hiring-onboarding') = 'Hiring & Onboarding');
select id as sub_id from miso.spaces where slug = 'subtop-hiring-onboarding' \gset

-- Who sees it, and its tabs.
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b2');
select pg_temp.ok('an admin sees the parent', miso.sees_space('sub-top'));
select pg_temp.ok('an admin does not see a subspace', (select count(*) from miso.spaces where parent_id is not null) = 0);
select pg_temp.ok('nor its tabs', (select count(*) from miso.tabs t join miso.spaces s on s.id = t.space_id where s.slug like 'subtop-%') = 0);
select pg_temp.ok('nor can they add one', pg_temp.try(format('insert into miso.tabs (space_id, ref) values (%L, %L)', :'sub_id', 'view:a/b')) = 'refused');
reset role;
-- A rule that names admins doesn't open a subspace either.
insert into miso.space_access (space_id, tiers) values (:'sub_id', '{admin,member}');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b3');
select pg_temp.ok('a member named on a rule still does not see a subspace', not miso.sees_space(:'sub_id'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select pg_temp.ok('an owner sees both subspaces', (select count(*) from miso.spaces where parent_id = 'sub-top') = 2);
reset role;

-- Deleting one: tabs go, shared records move to the parent.
insert into miso.records (collection, key, data, space_id) values ('notes', 'k1', '{}', :'sub_id');
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b2');
select pg_temp.ok('an admin cannot delete a subspace', pg_temp.try(format('select miso.delete_subspace(%L)', :'sub_id')) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000005b1');
select pg_temp.ok('an owner cannot delete a top-level space this way', pg_temp.try($$select miso.delete_subspace('sub-top')$$) = 'refused');
select pg_temp.ok('an owner deletes a subspace', pg_temp.try(format('select miso.delete_subspace(%L)', :'sub_id')) = '1');
reset role;
select pg_temp.ok('its tabs went with it', (select count(*) from miso.tabs where space_id = :'sub_id') = 0);
select pg_temp.ok('its records moved to the parent', (select space_id from miso.records where collection = 'notes' and key = 'k1') = 'sub-top');
select pg_temp.ok('the parent and its other subspace stay', (select count(*) from miso.spaces where id = 'sub-top' or parent_id = 'sub-top') = 2);
rollback;
