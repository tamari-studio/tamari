-- Change history: what miso.change_history records, who reads it, and that logging never makes a
-- write to miso.records, miso.tabs or miso.spaces fail. Runs in one transaction and rolls it back,
-- so it changes nothing. Stops at the first failed expectation (each prints FAIL and why); the last
-- line says all passed.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/checks/change-history.sql
--
-- On a database where 20261123000200_change_history hasn't run yet, add `-v unapplied=1` to run it
-- inside the transaction first.
\set ON_ERROR_STOP 1
begin;
\if :{?unapplied}
\ir ../migrations/20261123000200_change_history.sql
\endif

-- An owner, an admin, a member and a service account; a space everyone sees and one only owners see.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'history-owner@x.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'history-admin@x.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'history-member@x.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000e4', 'history-service@x.test', now(), 'authenticated', 'authenticated', '{"miso_service": true}');
set local app.actor_id = '00000000-0000-0000-0000-0000000000e1';
update app.app_user set status = 'active', tier = 'owner', display_name = 'Olga Owner' where email = 'history-owner@x.test';
update app.app_user set status = 'active', tier = 'admin', display_name = 'Ada Admin' where email = 'history-admin@x.test';
update app.app_user set status = 'active', tier = 'member', display_name = 'Anna Member' where email = 'history-member@x.test';
delete from app.app_user where email = 'history-service@x.test';
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000000e4', 'member');
insert into miso.spaces (id, slug, name) values ('history-open', 'history-open', 'Open'), ('history-secret', 'history-secret', 'Secret');
update miso.spaces set min_tier = 'owner' where id = 'history-secret';

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.as_nobody() returns void language sql as $$
  select set_config('request.jwt.claims', '', true), set_config('request.headers', '', true), set_config('role', 'postgres', true) $$;
create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL: %', what; end if;
end $$;
-- One record's history as text: "1 insert, 2 update".
create function pg_temp.versions(p_collection text, p_key text) returns text language sql as $$
  select coalesce(string_agg(version || ' ' || action, ', ' order by version), '')
    from miso.change_history where source = 'record' and collection = p_collection and key = p_key $$;

-- A write with nobody signed in (a job with the database password or the secret key) --------------
insert into miso.records (collection, key, data, space_id) values ('history-notes', 'a', '{"title": "First"}', 'history-open');
update miso.records set data = '{"title": "Second"}' where collection = 'history-notes' and key = 'a';
update miso.records set data = '{"title": "Second"}' where collection = 'history-notes' and key = 'a';
delete from miso.records where collection = 'history-notes' and key = 'a';
insert into miso.records (collection, key, data, space_id) values ('history-notes', 'a', '{"name": "Again"}', 'history-open');
select pg_temp.expect(pg_temp.versions('history-notes', 'a') = '1 insert, 2 update, 3 delete, 4 insert',
  'insert, update, the same save again, delete, insert: ' || pg_temp.versions('history-notes', 'a'));
select pg_temp.expect((select bool_and(actor is null) from miso.change_history where collection = 'history-notes'),
  'a write with nobody signed in has no actor');
select pg_temp.expect((select string_agg(label, ',' order by version) from miso.change_history where collection = 'history-notes') = 'First,Second,Second,Again',
  'the label is the title or the name; a delete keeps what was removed');

-- The secret key with a user id that is no account: the write goes through, with no actor.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000ff", "role": "service_role"}', true), set_config('role', 'service_role', true);
insert into miso.records (collection, key, data, updated_by) values ('history-notes', 'ghost', '{}', null);
do $$ begin
  insert into miso.change_history (source, action, key) values ('space', 'insert', 'x');
  raise exception 'FAIL: the secret key inserted a history row';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from miso.change_history;
  raise exception 'FAIL: the secret key deleted history rows';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_nobody();
select pg_temp.expect((select actor is null from miso.change_history where key = 'ghost'), 'an unknown user id is logged as no actor');

-- A record from before the history: its first change also keeps what it held.
insert into miso.records (collection, key, data, space_id) values ('history-notes', 'old', '{"title": "Before"}', 'history-open');
delete from miso.change_history where collection = 'history-notes' and key = 'old';
update miso.records set data = '{"title": "After"}' where collection = 'history-notes' and key = 'old';
select pg_temp.expect(pg_temp.versions('history-notes', 'old') = '1 snapshot, 2 update', 'snapshot: ' || pg_temp.versions('history-notes', 'old'));
select pg_temp.expect((select data ->> 'title' from miso.change_history where key = 'old' and version = 1) = 'Before', 'the snapshot holds the data from before');

-- A record that gets another key: the old key ends with a delete, the new one starts. Twice, so
-- the second time both keys already have history.
update miso.records set key = 'renamed' where collection = 'history-notes' and key = 'old';
select pg_temp.expect(pg_temp.versions('history-notes', 'old') = '1 snapshot, 2 update, 3 delete', 'old key: ' || pg_temp.versions('history-notes', 'old'));
select pg_temp.expect(pg_temp.versions('history-notes', 'renamed') = '1 insert', 'new key: ' || pg_temp.versions('history-notes', 'renamed'));
update miso.records set key = 'old', data = '{"title": "Back"}' where collection = 'history-notes' and key = 'renamed';
select pg_temp.expect(pg_temp.versions('history-notes', 'old') = '1 snapshot, 2 update, 3 delete, 4 insert', 'old key again: ' || pg_temp.versions('history-notes', 'old'));
select pg_temp.expect(pg_temp.versions('history-notes', 'renamed') = '1 insert, 2 delete', 'new key again: ' || pg_temp.versions('history-notes', 'renamed'));
-- And a record from before the history that gets another key.
insert into miso.records (collection, key, data) values ('history-notes', 'older', '{}');
delete from miso.change_history where collection = 'history-notes' and key = 'older';
update miso.records set key = 'older-2' where collection = 'history-notes' and key = 'older';
select pg_temp.expect(pg_temp.versions('history-notes', 'older') = '1 snapshot, 2 delete', 'older: ' || pg_temp.versions('history-notes', 'older'));

-- A record that moves to another space takes its history along.
insert into miso.records (collection, key, data, space_id) values ('history-plans', 'p', '{"title": "Plan"}', 'history-open');
update miso.records set space_id = 'history-secret' where collection = 'history-plans' and key = 'p';
select pg_temp.expect(pg_temp.versions('history-plans', 'p') = '1 insert', 'a move alone is not a version');
select pg_temp.expect((select space_id from miso.change_history where collection = 'history-plans') = 'history-secret', 'the history moved with the record');

-- The service account, as space code writes -------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e4');
select set_config('request.headers', '{"x-miso-caller": "00000000-0000-0000-0000-0000000000E3"}', true);
insert into miso.records (collection, key, data, space_id) values ('history-budget', 'b', '{"title": "Budget 2027"}', 'history-open');
select set_config('request.headers', '{"x-miso-caller": "00000000-0000-0000-0000-0000000000aa"}', true);
update miso.records set data = '{"title": "Budget 2027", "total": 1}' where collection = 'history-budget' and key = 'b';
select set_config('request.headers', '{"x-miso-caller": "not-an-id"}', true);
update miso.records set data = '{"title": "Budget 2027", "total": 2}' where collection = 'history-budget' and key = 'b';
select set_config('request.headers', '{}', true);
update miso.records set data = '{"title": "Budget 2027", "total": 3}' where collection = 'history-budget' and key = 'b';
-- What the service account writes to tabs and spaces is not a person's change.
insert into miso.tabs (space_id, ref) values ('history-open', 'view:history/by-service');
select pg_temp.expect((select count(*) from miso.change_history where collection = 'history-budget') = 4, 'the service account reads the history');
select pg_temp.as_nobody();
select pg_temp.expect(
  (select string_agg(right(actor::text, 2), ',' order by version) from miso.change_history where collection = 'history-budget') = 'e3,e4,e4,e4',
  'the member named in x-miso-caller is the actor; an unknown id, junk or no header leaves the service account');
select pg_temp.expect(not exists (select 1 from miso.change_history where key = 'view:history/by-service'), 'a tab the service account adds is not logged');

-- The member --------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
-- Their own session, claiming to be the admin: logged as themself.
select set_config('request.headers', '{"x-miso-caller": "00000000-0000-0000-0000-0000000000e2"}', true);
insert into miso.records (collection, key, data, space_id) values ('history-budget', 'direct', '{"label": "Direct"}', 'history-open');
select set_config('request.headers', '', true);
select pg_temp.expect((select right(actor::text, 2) from miso.change_history where key = 'direct') = 'e3', 'a member is logged as themself, whatever the header says');
select pg_temp.expect(exists (select 1 from miso.change_history where space_id = 'history-open'), 'a member reads the history of a space they see');
select pg_temp.expect(exists (select 1 from miso.change_history where space_id is null and key = 'ghost'), 'a member reads the history of records with no space');
select pg_temp.expect(not exists (select 1 from miso.change_history where space_id = 'history-secret'), 'a member reads no history of a space they do not see');

do $$ begin
  insert into miso.change_history (source, action, key) values ('space', 'insert', 'x');
  raise exception 'FAIL: a member inserted a history row';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update miso.change_history set actor = null;
  raise exception 'FAIL: a member updated history rows';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from miso.change_history;
  raise exception 'FAIL: a member deleted history rows';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform miso.trim_change_history();
  raise exception 'FAIL: a member ran the trim';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform * from miso.change_writer();
  raise exception 'FAIL: a member called change_writer()';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform miso.add_record_version('insert', r, null, null, null) from miso.records r limit 1;
  raise exception 'FAIL: a member called add_record_version()';
exception when insufficient_privilege then null;
end $$;

do $$
declare n int; emails int; service boolean;
begin
  select count(*), count(email) into n, emails from miso.history_actors(array[
    '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e4']::uuid[]);
  -- The owner has changed nothing yet, so there is no name for them.
  if n <> 2 or emails <> 0 then
    raise exception 'FAIL: a member got % names and % emails from history_actors, expected 2 and 0', n, emails;
  end if;
  select automatic into service from miso.history_actors(array['00000000-0000-0000-0000-0000000000e4']::uuid[]);
  if service is not true then raise exception 'FAIL: the service account is not marked automatic'; end if;
  if (select name from miso.history_actors(array['00000000-0000-0000-0000-0000000000e3']::uuid[])) <> 'Anna Member' then
    raise exception 'FAIL: the member''s name is missing';
  end if;
end $$;

-- A member opens, moves and closes a page. The Widgets tab and a reorder say nothing.
insert into miso.tabs (space_id, ref) values ('history-open', 'view:history/page'), ('history-open', 'widgets');
update miso.tabs set position = 3 where space_id = 'history-open' and ref = 'view:history/page';
select pg_temp.as_nobody();

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select pg_temp.expect(not exists (select 1 from miso.change_history where space_id = 'history-secret'), 'an admin reads no history of an owners-only space');
select pg_temp.expect(
  (select email from miso.history_actors(array['00000000-0000-0000-0000-0000000000e3']::uuid[])) = 'history-member@x.test',
  'an admin gets the email with the name');
select pg_temp.as_nobody();

select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true);
do $$ begin
  perform 1 from miso.change_history;
  raise exception 'FAIL: someone not signed in read the history';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform * from miso.history_actors(array['00000000-0000-0000-0000-0000000000e3']::uuid[]);
  raise exception 'FAIL: someone not signed in read names';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_nobody();

-- The owner: sees everything, adds, renames and deletes spaces -----------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.expect(exists (select 1 from miso.change_history where space_id = 'history-secret'), 'an owner reads the history of every space');
select id as new_space from miso.create_space('New', null) \gset
select miso.rename_space(:'new_space', 'Newer');
select miso.edit_space(:'new_space', 'Newer', 'star');
update miso.tabs set space_id = :'new_space' where space_id = 'history-open' and ref = 'view:history/page';
delete from miso.tabs where space_id = :'new_space' and ref = 'view:history/page';
insert into miso.tabs (space_id, ref) values ('history-open', 'view:history/stays');
-- A subspace with a record and a tab, deleted: the record and its history go to the parent.
select id as sub_space from miso.create_subspace(:'new_space', 'Sub') \gset
insert into miso.records (collection, key, data, space_id) values ('history-sub', 's', '{"title": "In the subspace"}', :'sub_space');
insert into miso.tabs (space_id, ref) values (:'sub_space', 'view:history/sub');
select miso.delete_subspace(:'sub_space');
select pg_temp.as_nobody();
-- A space that has records, tabs and history, deleted with nobody signed in (the sync from
-- spaces.json does that): it must go through.
delete from miso.spaces where id = 'history-open';

select pg_temp.expect(
  (select string_agg(action || coalesce(' from ' || (data ->> 'from'), ''), ', ' order by id) from miso.change_history where source = 'space' and key = :'new_space')
    = 'insert, update from New',
  'a space added and renamed is logged, a new symbol is not');
select pg_temp.expect(
  (select string_agg(action || ' ' || (space_id = :'new_space'), ', ' order by id) from miso.change_history where source = 'tab' and key = 'view:history/page')
    = 'insert false, update true, delete true',
  'a page opened, moved and closed is logged');
select pg_temp.expect(not exists (select 1 from miso.change_history where source = 'tab' and key = 'widgets'), 'the Widgets tab is not logged');
select pg_temp.expect(
  (select string_agg(action, ', ' order by id) from miso.change_history where source = 'tab' and key in ('view:history/stays', 'view:history/sub')) = 'insert, insert',
  'tabs that go with their space are not logged one by one');
select pg_temp.expect(
  (select string_agg(action || ' ' || right(actor::text, 2), ', ' order by id) from miso.change_history where source = 'space' and key = :'sub_space') = 'insert e1, delete e1',
  'a subspace added and deleted is logged');
select pg_temp.expect((select space_id from miso.change_history where collection = 'history-sub') = :'new_space', 'the history of a subspace''s records goes to the parent with them');
select pg_temp.expect(not exists (select 1 from miso.change_history where source = 'space' and key = 'history-open'), 'a space deleted with nobody signed in is not logged');
select pg_temp.expect((select space_id is null from miso.records where collection = 'history-budget' and key = 'b'), 'the records of a deleted space stay, with no space');
select pg_temp.expect((select bool_and(space_id is null) from miso.change_history where collection = 'history-budget' and key = 'b'),
  'the history of those records follows them');
-- The history of a record that was removed before its space was has nothing to follow: it stays
-- with the deleted space, for owners only.
select pg_temp.expect((select bool_and(space_id = 'history-open') from miso.change_history where collection = 'history-notes' and key = 'renamed'),
  'the history of a record removed earlier stays with the deleted space');
-- A space made with nobody signed in (the sync from spaces.json) is not a person's change.
insert into miso.spaces (id, slug, name) values ('history-sync', 'history-sync', 'Sync');
select pg_temp.expect(not exists (select 1 from miso.change_history where key = 'history-sync'), 'a space added with nobody signed in is not logged');

-- What is left of a deleted space (its tabs, its own rows) is for owners only.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
select pg_temp.expect(not exists (select 1 from miso.change_history where space_id = 'history-open'), 'a member reads no rows of a deleted space');
select pg_temp.expect(exists (select 1 from miso.change_history where collection = 'history-budget'), 'a member still reads the history of its records');
select pg_temp.as_nobody();
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select pg_temp.expect(exists (select 1 from miso.change_history where space_id = 'history-open'), 'an owner reads the rows of a deleted space');
select pg_temp.as_nobody();

-- Deleting an account keeps its changes, with no actor.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e3';
select pg_temp.expect(
  (select count(*) > 0 and bool_and(actor is null) from miso.change_history where key = 'direct' or (key = 'view:history/page' and action = 'insert')),
  'a deleted account''s changes stay, with no actor');

-- Retention: 400 days, and the newest 200 versions of a record.
insert into miso.change_history (at, source, action, collection, key, version, data)
  values (now() - interval '401 days', 'record', 'insert', 'history-trim', 'aged', 1, '{}'),
         (now() - interval '399 days', 'record', 'update', 'history-trim', 'aged', 2, '{}');
insert into miso.records (collection, key, data) values ('history-trim', 'busy', '{"n": 0}');
do $$ begin
  for i in 1..204 loop
    update miso.records set data = jsonb_build_object('n', i) where collection = 'history-trim' and key = 'busy';
  end loop;
end $$;
select miso.trim_change_history();
select pg_temp.expect(pg_temp.versions('history-trim', 'aged') = '2 update', 'the trim deletes rows older than 400 days: ' || pg_temp.versions('history-trim', 'aged'));
select pg_temp.expect(
  (select count(*) = 200 and min(version) = 6 and max(version) = 205 from miso.change_history where collection = 'history-trim' and key = 'busy'),
  'the trim keeps the newest 200 versions of a record');

select 'change-history check: all passed';
rollback;
