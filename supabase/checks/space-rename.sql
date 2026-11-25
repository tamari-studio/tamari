-- Space renames (20261116000400_space_rename_admins): only admins and owners, only through
-- miso.rename_space(). Runs in one transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/space-rename.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

-- The owner first: on a fresh database the first account becomes the owner, and the last owner
-- can't be demoted.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a0', 'owner@rename.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000007a1', 'admin@rename.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000007a2', 'member@rename.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000007a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@rename.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@rename.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@rename.test';
insert into miso.spaces (id, slug, name) values ('rn-a', 'rn-a', 'A'), ('rn-own', 'rn-own', 'Owners');
update miso.spaces set min_tier = 'owner' where id = 'rn-own';

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

select pg_temp.as_user('00000000-0000-0000-0000-0000000007a2');
select pg_temp.ok('a member cannot rename through the function', pg_temp.try($$select miso.rename_space('rn-a', 'Nope')$$) = 'refused');
select pg_temp.ok('nor with a direct update', pg_temp.try($$update miso.spaces set name = 'Nope' where id = 'rn-a'$$) = 'refused');
select pg_temp.ok('nor change a theme', pg_temp.try($$update miso.spaces set theme = '{}' where id = 'rn-a'$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a1');
select pg_temp.ok('an admin renames a space, trimmed', (miso.rename_space('rn-a', '  Alpha ')).name = 'Alpha');
select pg_temp.ok('but not to a blank name', pg_temp.try($$select miso.rename_space('rn-a', '   ')$$) = 'refused');
select pg_temp.ok('nor a space admins do not see', pg_temp.try($$select miso.rename_space('rn-own', 'Mine')$$) = 'refused');
select pg_temp.ok('and an admin has no direct update either', pg_temp.try($$update miso.spaces set name = 'X' where id = 'rn-a'$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a0');
select pg_temp.ok('an owner renames an owners-only space', (miso.rename_space('rn-own', 'Board')).name = 'Board');
reset role;
select pg_temp.ok('the names are saved', (select string_agg(name, ',' order by id) from miso.spaces where id like 'rn-%') = 'Alpha,Board');
rollback;
