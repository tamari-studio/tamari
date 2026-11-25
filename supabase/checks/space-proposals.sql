-- Proposals (20261124000200_space_proposals): who reads and writes miso.space_proposals, a draft
-- copy as a subspace its author sees, and publishing a draft to a team or everyone. Runs in one
-- transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/space-proposals.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a0', 'owner@proposals.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a1', 'admin@proposals.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a2', 'author@proposals.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a3', 'mate@proposals.test',   now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000009a4', 'other@proposals.test',  now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000009a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@proposals.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@proposals.test';
update app.app_user set tier = 'member', status = 'active' where email in ('author@proposals.test', 'mate@proposals.test', 'other@proposals.test');

-- The author and a mate share a team; the other member is in none.
insert into miso.departments (id, name) values ('00000000-0000-0000-0000-0000000009d1', 'Proposals team');
insert into miso.department_members (department_id, user_id) values
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a2'),
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a3');

insert into miso.spaces (id, slug, name, theme, created_by, visibility) values
  ('live-p', 'livep', 'Live', '{}', null, 'everyone'),
  ('mine-p', 'minep', 'Mine', '{}', '00000000-0000-0000-0000-0000000009a2', 'draft');

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

-- The service account (role 'service' in miso.members, as the vault account is).
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000009a9', 'service@proposals.test', now(), 'authenticated', 'authenticated', '{"miso_service": true}', '{"miso_service": true}');
delete from app.app_user where email = 'service@proposals.test';
insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000009a9', 'service') on conflict (user_id) do update set role = 'service';

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a9');
select miso.sync_spaces('[{"id": "live-p--draft-abc123", "slug": "live-p--draft-abc123", "name": "Live (your draft)", "folder": "live-p--draft-abc123", "draft": true,
                           "created_by": "00000000-0000-0000-0000-0000000009a2", "parent_id": "live-p"},
                          {"id": "stray-p", "slug": "strayp", "name": "Stray", "folder": "strayp", "draft": false, "parent_id": "live-p"}]'::jsonb);
select pg_temp.ok('the service account adds a proposal',
  pg_temp.try($$insert into miso.space_proposals (kind, space_id, draft_space_id, draft_folder, summary, author, author_line, base_commit, reviewed_commit)
                values ('change', 'live-p', 'live-p--draft-abc123', 'live-p--draft-abc123', 'Better', '00000000-0000-0000-0000-0000000009a2', 'Author <author@proposals.test>', 'base', 'rev')$$) = 'ran');
select pg_temp.ok('a second open proposal for the same draft is refused',
  pg_temp.try($$insert into miso.space_proposals (kind, space_id, draft_space_id, draft_folder, summary, author, author_line, base_commit, reviewed_commit)
                values ('change', 'live-p', 'live-p--draft-abc123', 'live-p--draft-abc123', 'Again', '00000000-0000-0000-0000-0000000009a2', 'Author <author@proposals.test>', 'base', 'rev')$$) = 'refused');
select pg_temp.ok('a publication names who sees it',
  pg_temp.try($$insert into miso.space_proposals (kind, space_id, draft_space_id, draft_folder, summary, author, author_line, reviewed_commit)
                values ('publish', 'mine-p', 'mine-p', 'minep', 'Share', '00000000-0000-0000-0000-0000000009a2', 'Author <author@proposals.test>', 'rev')$$) = 'refused');
reset role;

select pg_temp.ok('a draft copy from spaces.json is a subspace of the space it copies, and a draft',
  (select parent_id = 'live-p' and visibility = 'draft' from miso.spaces where id = 'live-p--draft-abc123'));
select pg_temp.ok('an entry that is not a draft takes no parent', (select parent_id is null from miso.spaces where id = 'stray-p'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a2');
select pg_temp.ok('the author sees their copy (a subspace) and their proposal',
  (select count(*) from miso.spaces where id = 'live-p--draft-abc123') = 1 and (select count(*) from miso.space_proposals) = 1);
select pg_temp.ok('the author cannot change their proposal themselves', pg_temp.try($$update miso.space_proposals set status = 'approved'$$) = 'ran'
  and (select status from miso.space_proposals) = 'open');
select pg_temp.ok('the author cannot add a proposal themselves',
  pg_temp.try($$insert into miso.space_proposals (kind, space_id, draft_folder, summary, author, author_line, base_commit, reviewed_commit)
                values ('change', 'live-p', 'x', 'x', '00000000-0000-0000-0000-0000000009a2', 'A <a@b.c>', 'b', 'r')$$) = 'refused');
select pg_temp.ok('a member cannot publish a space', pg_temp.try($$select miso.publish_space('mine-p', 'everyone', '00000000-0000-0000-0000-0000000009a2')$$) = 'refused');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a4');
select pg_temp.ok('another member sees neither the copy nor the proposal',
  (select count(*) from miso.spaces where id = 'live-p--draft-abc123') = 0 and (select count(*) from miso.space_proposals) = 0);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a1');
select pg_temp.ok('an admin sees the proposal', (select count(*) from miso.space_proposals) = 1);
select pg_temp.ok('an admin cannot decide it past the app', pg_temp.try($$update miso.space_proposals set status = 'approved'$$) = 'ran'
  and (select status from miso.space_proposals) = 'open');
reset role;

-- Publishing to the author's team: the rule is written in the same step.
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a9');
select pg_temp.ok('the service account does not publish someone else''s draft', not (select miso.publish_space('mine-p', 'team', '00000000-0000-0000-0000-0000000009a3')));
select pg_temp.ok('the service account does not publish a draft copy', not (select miso.publish_space('live-p--draft-abc123', 'team', '00000000-0000-0000-0000-0000000009a2')));
select pg_temp.ok('the service account publishes the author''s draft to their team', (select miso.publish_space('mine-p', 'team', '00000000-0000-0000-0000-0000000009a2')));
reset role;
select pg_temp.ok('the space is team, with a rule naming the author''s team, the author and admins',
  (select s.visibility = 'team' and a.tiers = array['admin'::app.tier] and a.departments = array['00000000-0000-0000-0000-0000000009d1'::uuid]
          and a.people = array['00000000-0000-0000-0000-0000000009a2'::uuid]
     from miso.spaces s join miso.space_access a on a.space_id = s.id where s.id = 'mine-p'));

select pg_temp.as_user('00000000-0000-0000-0000-0000000009a3');
select pg_temp.ok('a team mate sees the published space', (select count(*) from miso.spaces where id = 'mine-p') = 1);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a4');
select pg_temp.ok('a member outside the team does not', (select count(*) from miso.spaces where id = 'mine-p') = 0);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000009a1');
select pg_temp.ok('an admin does', (select count(*) from miso.spaces where id = 'mine-p') = 1);
reset role;

rollback;
