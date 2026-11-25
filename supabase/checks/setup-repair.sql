-- The repair in scripts/supabase-setup.ts (20261124000300_setup_repair_grants): through the secret
-- key (service_role) it drops a service account's app.app_user row and writes its miso.members row.
-- Each part runs in one transaction and rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/setup-repair.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.

create function pg_temp.ok(label text, cond boolean) returns text language sql as $$
  select case when cond is true then 'ok   ' else 'FAIL ' end || label $$;
create function pg_temp.try(stmt text) returns text language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
exception when others then return 'refused: ' || sqlerrm;
end $$;

-- Part 1, the owner seat: an app older than the flag signed the spaces account in before the setup
-- ran (the session broker's first magic link creates the account), so it was the first person and
-- became the owner. The setup can't drop that row (the last-owner lock stays as it is); a person who
-- signs in later waits as pending. makeOwner (cli/provision.ts) makes the real owner and then drops
-- the row. An account created flagged, as the broker does now, never takes the seat.
begin;
select pg_temp.ok('nobody is here yet (the owner seat case needs an empty app.app_user)', not exists (select 1 from app.app_user));

-- Flagged at creation (the broker now, and the setup): no person row, so a person is still first.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007b0', 'flagged@repair.test', now(), 'authenticated', 'authenticated', '{"miso_service": true}');
select pg_temp.ok('a service account created flagged gets no person row', not exists (select 1 from app.app_user));

-- Unflagged (the broker before this fix): the first person, so the owner.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007b1', 'spaces@repair.test', now(), 'authenticated', 'authenticated', '{}');
select pg_temp.ok('an unflagged service account made first becomes the owner',
  exists (select 1 from app.app_user where user_id = '00000000-0000-0000-0000-0000000007b1' and tier = 'owner' and status = 'active'));

-- The setup flags it (auth admin API), then tries to drop its row through the secret key.
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}') || '{"miso_service": true}' where id = '00000000-0000-0000-0000-0000000007b1';
set local role service_role;
select pg_temp.ok('the setup can''t drop the owner seat''s row (the last-owner lock refuses it)',
  pg_temp.try($$delete from app.app_user where user_id = '00000000-0000-0000-0000-0000000007b1'$$) like 'refused: last-owner invariant%');
select pg_temp.ok('but writes its members row',
  pg_temp.try($$insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000007b1', 'member') on conflict (user_id) do update set role = excluded.role$$) = '1');
reset role;

-- The real owner signs in later: not first, so pending.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007b2', 'human@repair.test', now(), 'authenticated', 'authenticated', '{}');
select pg_temp.ok('the person who signs in later waits as pending',
  exists (select 1 from app.app_user where user_id = '00000000-0000-0000-0000-0000000007b2' and tier is null and status = 'pending'));

-- makeOwner's SQL (cli/provision.ts): the person becomes owner, then the service rows go.
set local app.actor_id = '00000000-0000-0000-0000-0000000007b2';
insert into app.app_user (user_id, email, tier, status) values ('00000000-0000-0000-0000-0000000007b2', 'human@repair.test', 'owner', 'active')
  on conflict (user_id) do update set tier = 'owner', status = 'active' where app_user.tier is distinct from 'owner' or app_user.status <> 'active';
select pg_temp.ok('makeOwner drops the service account''s row once a person is owner',
  pg_temp.try($$delete from app.app_user a using auth.users u where u.id = a.user_id and u.raw_app_meta_data ->> 'miso_service' = 'true'$$) = '1');
select pg_temp.ok('the person is the only owner',
  (select array_agg(user_id::text) from app.app_user where tier = 'owner' and status = 'active') = array['00000000-0000-0000-0000-0000000007b2']);
select pg_temp.ok('the person''s promotion is logged with them as the actor',
  exists (select 1 from app.tier_change where user_id = '00000000-0000-0000-0000-0000000007b2' and to_tier = 'owner' and changed_by = '00000000-0000-0000-0000-0000000007b2'));
select pg_temp.ok('the lock still refuses to remove the last real owner',
  pg_temp.try($$delete from app.app_user where user_id = '00000000-0000-0000-0000-0000000007b2'$$) like 'refused: last-owner invariant%');
rollback;

-- Part 2: an owner first, so neither account below is the first person. Then a setup cut off after
-- it made the spaces account (flagged, so no person row), and a vault account the broker made
-- before the setup ran (a pending person row).
begin;
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a0', 'owner@repair.test',  now(), 'authenticated', 'authenticated', '{}');
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'spaces@repair.test', now(), 'authenticated', 'authenticated', '{"miso_service": true}'),
  ('00000000-0000-0000-0000-0000000007a2', 'vault@repair.test',  now(), 'authenticated', 'authenticated', '{}');

select pg_temp.ok('the cut-off spaces account has no person row', not exists (select 1 from app.app_user where user_id = '00000000-0000-0000-0000-0000000007a1'));
select pg_temp.ok('the broker-made vault account has one', exists (select 1 from app.app_user where user_id = '00000000-0000-0000-0000-0000000007a2'));

set local role service_role;
select pg_temp.ok('the secret key drops the cut-off account''s (missing) person row',
  pg_temp.try($$delete from app.app_user where user_id = '00000000-0000-0000-0000-0000000007a1'$$) = '0');
select pg_temp.ok('and writes its members row',
  pg_temp.try($$insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000007a1', 'member') on conflict (user_id) do update set role = excluded.role$$) = '1');
select pg_temp.ok('the secret key drops the broker-made account''s person row',
  pg_temp.try($$delete from app.app_user where user_id = '00000000-0000-0000-0000-0000000007a2'$$) = '1');
select pg_temp.ok('and writes its members row',
  pg_temp.try($$insert into miso.members (user_id, role) values ('00000000-0000-0000-0000-0000000007a2', 'service') on conflict (user_id) do update set role = excluded.role$$) = '1');
reset role;

select pg_temp.ok('the owner keeps their person row', exists (select 1 from app.app_user where user_id = '00000000-0000-0000-0000-0000000007a0'));
select pg_temp.ok('both service accounts are members now',
  (select count(*) from miso.members where user_id in ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007a2')) = 2);
rollback;
