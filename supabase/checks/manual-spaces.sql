-- Manual spaces (20261117000100_manual_spaces): admins and owners add a top-level space with no
-- folder through miso.create_space(), and miso.sync_spaces() leaves it alone. Runs in one
-- transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/manual-spaces.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a0', 'owner@manual.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a1', 'admin@manual.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a2', 'member@manual.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a3', 'service@manual.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000009a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@manual.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@manual.test';
update app.app_user set tier = 'member', status = 'active' where email in ('member@manual.test', 'service@manual.test');
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000009a3', 'service');
insert into miso.spaces (id, slug, name, folder, "position") values ('ms-cat', 'ms-design', 'Catalog', 'ms-cat', 9000);

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
create temp table made (id text, slug text, folder text, parent_id text, "position" integer, symbol text) on commit drop;
grant all on made to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a2');
select pg_temp.ok('a member cannot add a space', pg_temp.try($$select miso.create_space('Mine', null)$$) = 'refused');
select pg_temp.ok('nor with a direct insert', pg_temp.try($$insert into miso.spaces (id, slug, name) values ('x', 'x', 'X')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a1');
insert into made select s.id, s.slug, s.folder, s.parent_id, s."position", s.symbol from miso.create_space(' MS Design ', 'palette') s;
select pg_temp.ok('an admin adds one: top level, no folder, last', (select folder is null and parent_id is null and "position" > 9000 from made));
select pg_temp.ok('with a space- id and the symbol', (select id ~ '^space-[0-9a-f]{32}$' and symbol = 'palette' from made));
select pg_temp.ok('a slug taken by another space gets a number', (select slug = 'ms-design-2' from made));
select pg_temp.ok('a shell page name is never a slug', (select slug = 'settings-2' from miso.create_space('Settings', null)));
select pg_temp.ok('but not a blank name', pg_temp.try($$select miso.create_space('  ', null)$$) = 'refused');
select pg_temp.ok('nor a name on two lines', pg_temp.try($$select miso.create_space(e'a\nb', null)$$) = 'refused');
select pg_temp.ok('nor a symbol of another shape', pg_temp.try($$select miso.create_space('A', '<svg>')$$) = 'refused');
select pg_temp.ok('the admin renames it like any space', (miso.edit_space((select id from made), 'MS Studio', null)).name = 'MS Studio');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a2');
select pg_temp.ok('a member sees it (no rule)', exists (select 1 from miso.spaces where id = (select id from made)));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a0');
select pg_temp.ok('an owner makes a subspace under it', (select parent_id = (select id from made) from miso.create_subspace((select id from made), 'Brand')));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a3');
select miso.sync_spaces('[{"id": "ms-cat", "slug": "ms-design", "name": "Catalog", "folder": "ms-cat"}]');
reset role;
select pg_temp.ok('sync_spaces keeps it, slug and all', (select s.slug = 'ms-design-2' and s.name = 'MS Studio' from miso.spaces s where s.id = (select id from made)));
rollback;
