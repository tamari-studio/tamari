-- Space names and symbols (20261117000000_space_symbol): only admins and owners, only through
-- miso.edit_space(). Runs in one transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/space-symbol.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a0', 'owner@symbol.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008a1', 'admin@symbol.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008a2', 'member@symbol.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000008a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@symbol.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@symbol.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@symbol.test';
insert into miso.spaces (id, slug, name) values ('sy-a', 'sy-a', 'A'), ('sy-own', 'sy-own', 'Owners');
update miso.spaces set min_tier = 'owner' where id = 'sy-own';

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

select pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
select pg_temp.ok('a member cannot set a symbol', pg_temp.try($$select miso.edit_space('sy-a', null, 'rocket')$$) = 'refused');
select pg_temp.ok('nor with a direct update', pg_temp.try($$update miso.spaces set symbol = 'rocket' where id = 'sy-a'$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
select pg_temp.ok('an admin sets a symbol and keeps the name', (select (s.symbol, s.name) = ('rocket', 'A') from miso.edit_space('sy-a', null, 'rocket') s));
select pg_temp.ok('renames and keeps the symbol', (select (s.symbol, s.name) = ('rocket', 'Alpha') from miso.edit_space('sy-a', ' Alpha ', null) s));
select pg_temp.ok('but not to a symbol of another shape', pg_temp.try($$select miso.edit_space('sy-a', null, '<svg>')$$) = 'refused');
select pg_temp.ok('nor to a blank name', pg_temp.try($$select miso.edit_space('sy-a', '  ', null)$$) = 'refused');
select pg_temp.ok('nor a space admins do not see', pg_temp.try($$select miso.edit_space('sy-own', null, 'star')$$) = 'refused');
select pg_temp.ok('and an admin has no direct update either', pg_temp.try($$update miso.spaces set symbol = 'star' where id = 'sy-a'$$) = 'refused');
select pg_temp.ok('an empty symbol clears it', (miso.edit_space('sy-a', null, '')).symbol is null);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a0');
select pg_temp.ok('an owner edits an owners-only space', (select (s.symbol, s.name) = ('star', 'Board') from miso.edit_space('sy-own', 'Board', 'star') s));
reset role;
rollback;
