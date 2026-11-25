-- A person's own position (20261125000000_member_position). Runs in one transaction and rolls it
-- back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/member-position.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;
\if :{?unapplied}
\ir ../migrations/20261125000000_member_position.sql
\endif

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner@pos.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'member@pos.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'other@pos.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e4', 'pending@pos.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000000e1';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@pos.test';
update app.app_user set tier = 'member', status = 'active' where email in ('member@pos.test', 'other@pos.test');

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

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select pg_temp.ok('a member sets their own position', pg_temp.try($$select miso.set_own_position('  Head of sales ')$$) <> 'refused');
select pg_temp.ok('trimmed', (select position from app.app_user where user_id = auth.uid()) = 'Head of sales');
select pg_temp.ok('too long is refused', pg_temp.try(format('select miso.set_own_position(%L)', repeat('x', 81))) = 'refused');
select pg_temp.ok('two lines are refused', pg_temp.try(format('select miso.set_own_position(%L)', E'a\nb')) = 'refused');
select pg_temp.ok('a member still can''t change their own tier', pg_temp.try($$update app.app_user set tier = 'owner' where user_id = auth.uid()$$) in ('0', 'refused'));
select pg_temp.ok('nor the position column directly', pg_temp.try($$update app.app_user set position = 'CEO' where user_id = auth.uid()$$) in ('0', 'refused'));
reset role;
select pg_temp.ok('so the member is still a member', (select tier from app.app_user where email = 'member@pos.test') = 'member');
select pg_temp.ok('and nobody else''s position changed', (select position from app.app_user where email = 'other@pos.test') is null);
select pg_temp.ok('members have no update grant on position',
  not has_column_privilege('authenticated', 'app.app_user', 'position', 'UPDATE'));
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select pg_temp.ok('empty clears it', pg_temp.try($$select miso.set_own_position('   ')$$) <> 'refused');
reset role;
select pg_temp.ok('to null', (select position from app.app_user where email = 'member@pos.test') is null);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select pg_temp.ok('someone with no tier is refused', pg_temp.try($$select miso.set_own_position('Spy')$$) = 'refused');
reset role;
select pg_temp.ok('anon can''t call it', not has_function_privilege('anon', 'miso.set_own_position(text)', 'EXECUTE'));
rollback;
