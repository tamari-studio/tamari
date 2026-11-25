-- Draft spaces (20261124000100_draft_spaces): who sees a draft, through every policy that asks
-- miso.sees_space(): the space row, its tabs, its layout, its records, and the functions built on it.
-- A draft is seen by its creator (an active member), admins, owners and the service accounts; any
-- other member, a manager and someone waiting for a role get nothing. 'team' and 'everyone' spaces
-- keep the old rule. Runs in one transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/draft-spaces.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008d0', 'owner@drafts.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008d1', 'admin@drafts.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008d2', 'author@drafts.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008d3', 'member@drafts.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008d4', 'manager@drafts.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008d5', 'waiting@drafts.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000008d0';
update app.app_user set tier = 'owner',   status = 'active' where email = 'owner@drafts.test';
update app.app_user set tier = 'admin',   status = 'active' where email = 'admin@drafts.test';
update app.app_user set tier = 'member',  status = 'active' where email = 'author@drafts.test';
update app.app_user set tier = 'member',  status = 'active' where email = 'member@drafts.test';
update app.app_user set tier = 'manager', status = 'active' where email = 'manager@drafts.test';

-- A draft and an ordinary space, each with a tab, a layout and a record.
insert into miso.spaces (id, slug, name, theme, created_by, visibility) values
  ('draft-x', 'draftx', 'Draft', '{}', '00000000-0000-0000-0000-0000000008d2', 'draft'),
  ('open-x', 'openx', 'Open', '{}', null, 'everyone');
insert into miso.tabs (space_id, ref) values ('draft-x', 'widgets'), ('open-x', 'widgets');
insert into miso.space_layouts (space_id, widgets) values ('draft-x', '[]'), ('open-x', '[]');
insert into miso.records (collection, key, data, space_id) values ('drafts-check', 'd', '{}', 'draft-x'), ('drafts-check', 'o', '{}', 'open-x');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'ok   ' else 'FAIL ' end || label $$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ran';
exception when others then return 'refused';
end $$;
-- What one person sees of the draft: the row, its tabs, its layout, its records.
create function pg_temp.sees(space text) returns text language sql as $$
  select (select count(*) from miso.spaces where id = space) || '/' ||
         (select count(*) from miso.tabs where space_id = space) || '/' ||
         (select count(*) from miso.space_layouts where space_id = space) || '/' ||
         (select count(*) from miso.records where space_id = space) $$;

select pg_temp.ok('existing spaces default to everyone', (select visibility from miso.spaces where id = 'open-x') = 'everyone');

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d2');
select pg_temp.ok('the author sees the draft, its tabs, layout and records', pg_temp.sees('draft-x') = '1/1/1/1');
select pg_temp.ok('the author sees the open space', pg_temp.sees('open-x') = '1/1/1/1');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d3');
select pg_temp.ok('another member gets nothing of the draft', pg_temp.sees('draft-x') = '0/0/0/0');
select pg_temp.ok('another member cannot add a tab to it', pg_temp.try($$insert into miso.tabs (space_id, ref) values ('draft-x', 'view:x/y')$$) = 'refused');
select pg_temp.ok('another member still sees the open space', pg_temp.sees('open-x') = '1/1/1/1');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d4');
select pg_temp.ok('a manager gets nothing of the draft', pg_temp.sees('draft-x') = '0/0/0/0');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d5');
select pg_temp.ok('someone waiting for a role gets nothing of the draft', pg_temp.sees('draft-x') = '0/0/0/0');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d1');
select pg_temp.ok('an admin sees the draft (to review it)', pg_temp.sees('draft-x') = '1/1/1/1');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008d0');
select pg_temp.ok('an owner sees the draft', pg_temp.sees('draft-x') = '1/1/1/1');
reset role;

-- The author suspended: a draft is theirs only while they are a member.
update app.app_user set status = 'suspended' where email = 'author@drafts.test';
select pg_temp.as_user('00000000-0000-0000-0000-0000000008d2');
select pg_temp.ok('a suspended author gets nothing of the draft', pg_temp.sees('draft-x') = '0/0/0/0');
reset role;
update app.app_user set status = 'active' where email = 'author@drafts.test';

-- sync_spaces and delete_draft_space are the service account's: a member is refused both.
select pg_temp.as_user('00000000-0000-0000-0000-0000000008d2');
select pg_temp.ok('a member cannot sync spaces', pg_temp.try($$select miso.sync_spaces('[]'::jsonb)$$) = 'refused');
select pg_temp.ok('a member cannot delete a draft row, even their own', pg_temp.try($$select miso.delete_draft_space('draft-x', '00000000-0000-0000-0000-0000000008d2')$$) = 'refused');
reset role;

-- As the service account (role 'service' in miso.members, as the vault account is).
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000008d9', 'service@drafts.test', now(), 'authenticated', 'authenticated', '{"miso_service": true}', '{"miso_service": true}');
delete from app.app_user where email = 'service@drafts.test';
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000008d9', 'service') on conflict (user_id) do update set role = 'service';
select pg_temp.as_user('00000000-0000-0000-0000-0000000008d9');
select miso.sync_spaces('[{"id": "new-draft", "slug": "newdraft", "name": "New", "folder": "new-draft-folder", "draft": true, "created_by": "00000000-0000-0000-0000-0000000008d2"},
                          {"id": "open-x", "slug": "openx", "name": "Open", "folder": null, "draft": true, "created_by": "00000000-0000-0000-0000-0000000008d3"}]'::jsonb);
reset role;
select pg_temp.ok('a new spaces.json entry marked draft starts as its creator''s draft',
  (select visibility = 'draft' and created_by = '00000000-0000-0000-0000-0000000008d2' from miso.spaces where id = 'new-draft'));
select pg_temp.ok('an existing space keeps its visibility and creator whatever the entry says',
  (select visibility = 'everyone' and created_by is null from miso.spaces where id = 'open-x'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000008d9');
select pg_temp.ok('the service account does not delete someone else''s draft', pg_temp.try($$select miso.delete_draft_space('draft-x', '00000000-0000-0000-0000-0000000008d3')$$) <> 'refused'
  and exists (select 1 from miso.spaces where id = 'draft-x'));
select pg_temp.ok('the service account deletes the creator''s own draft', (select miso.delete_draft_space('draft-x', '00000000-0000-0000-0000-0000000008d2')));
select pg_temp.ok('it does not delete a space that is not a draft', not (select miso.delete_draft_space('open-x', '00000000-0000-0000-0000-0000000008d2')));
reset role;
select pg_temp.ok('the draft, its tabs and layout are gone', not exists (select 1 from miso.spaces where id = 'draft-x') and not exists (select 1 from miso.tabs where space_id = 'draft-x'));

rollback;
