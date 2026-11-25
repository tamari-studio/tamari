-- Who skips miso.sees_space(): the service accounts, and nobody else. Runs in one transaction and
-- rolls it back, so it changes nothing. Needs `bun run supabase:setup` (the two service accounts).
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/service-accounts.sql
--
-- On a database where 20261021000000…0400 haven't run yet, add `-v unapplied=1` to run them inside
-- the transaction first.
--
-- Expected: the spaces account sees miso `t` with 1 record and writes one more; its space insert is
-- refused; the admin-added and the forged member see miso `f` with 0 records, and the forged
-- member's insert is refused; no junk space exists.
begin;
\if :{?unapplied}
\ir ../migrations/20261021000000_audit_fixes.sql
\ir ../migrations/20261022000000_hidden_spaces.sql
\ir ../migrations/20261022000100_connectors_admin.sql
\ir ../migrations/20261022000200_spaces_position.sql
\ir ../migrations/20261022000300_sees_space_service_only.sql
\ir ../migrations/20261022000400_sees_space_service_marker.sql
\endif
-- Two people: a member an admin also put in miso.members (role member), and a member who forged
-- miso_service in their own user_metadata.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'added@x.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000b2', 'forged@x.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000000b1';
update app.app_user set tier = 'member', status = 'active' where email in ('added@x.test', 'forged@x.test');
update auth.users set raw_user_meta_data = '{"miso_service": true}' where email = 'forged@x.test';
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000000b1', 'member');
insert into miso.records (collection, key, data, space_id) values ('n', 'a', '{}', 'miso');
insert into miso.space_access (space_id, tiers) values ('miso', '{admin}');
create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
\set ON_ERROR_STOP 0
\set ON_ERROR_ROLLBACK on
select pg_temp.as_user((select id::text from auth.users where email = 'miso-spaces@example.com'));
select 'spaces account sees miso', miso.sees_space('miso'), 'records', (select count(*) from miso.records where space_id = 'miso');
insert into miso.records (collection, key, data, space_id) values ('n', 'b', '{}', 'miso');
select 'spaces account wrote', count(*) from miso.records where key = 'b';
insert into miso.spaces (id, slug, name) values ('junk-audit', 'junk-audit', 'Junk');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select 'admin-added member sees miso', miso.sees_space('miso'), 'records', (select count(*) from miso.records where space_id = 'miso');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
select 'forged member sees miso', miso.sees_space('miso'), 'records', (select count(*) from miso.records where space_id = 'miso');
insert into miso.records (collection, key, data, space_id) values ('n', 'c', '{}', 'miso');
reset role;
select 'junk space exists', count(*) from miso.spaces where id = 'junk-audit';
rollback;
