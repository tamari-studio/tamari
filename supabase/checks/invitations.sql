-- Invites (20261123000000_invitations): owners and admins invite an address at a role, a member and
-- a waiting account cannot, an admin can't invite an owner, and revoking is the only change. A
-- sign-up with an open invite lands active at its role; a revoked or expired one, or a different
-- address, falls back to the allowed-domain and waiting rules. Runs in one transaction and rolls it
-- back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/invitations.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a0', 'owner@invites.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008a1', 'admin@invites.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008a2', 'member@invites.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000008a3', 'nobody@invites.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000008a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@invites.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@invites.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@invites.test';

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true), set_config('role', 'anon', true) $$;
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
create function pg_temp.sign_up(addr text) returns uuid language sql as $$
  insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data)
  values (gen_random_uuid(), addr, now(), 'authenticated', 'authenticated', '{"full_name": "New Person"}')
  returning id $$;

-- Who may invite.
select pg_temp.as_anon();
select pg_temp.ok('anon reads no invites', pg_temp.try($$select 1 from miso.invitations$$) = 'refused');
select pg_temp.ok('anon cannot invite', pg_temp.try($$insert into miso.invitations (email, tier) values ('x@elsewhere.test', 'member')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
select pg_temp.ok('a member cannot invite', pg_temp.try($$insert into miso.invitations (email, tier) values ('x@elsewhere.test', 'member')$$) = 'refused');
select pg_temp.ok('a member reads no invites', pg_temp.try($$select 1 from miso.invitations$$) = '0');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
select pg_temp.ok('a waiting account cannot invite', pg_temp.try($$insert into miso.invitations (email, tier) values ('x@elsewhere.test', 'member')$$) = 'refused');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
select pg_temp.ok('an admin invites a manager', pg_temp.try($$insert into miso.invitations (email, tier) values ('jane@elsewhere.test', 'manager')$$) = '1');
select pg_temp.ok('the invite is credited to the admin and expires in 14 days',
  (select invited_by = '00000000-0000-0000-0000-0000000008a1' and expires_at::date = (now() + interval '14 days')::date
     from miso.invitations where email = 'jane@elsewhere.test'));
select pg_temp.ok('an admin cannot invite an owner', pg_temp.try($$insert into miso.invitations (email, tier) values ('boss@elsewhere.test', 'owner')$$) = 'refused');
select pg_temp.ok('an admin cannot credit someone else', pg_temp.try($$insert into miso.invitations (email, tier, invited_by) values ('k@elsewhere.test', 'member', '00000000-0000-0000-0000-0000000008a0')$$) = 'refused');
select pg_temp.ok('an address is stored lower-cased only', pg_temp.try($$insert into miso.invitations (email, tier) values ('Jane@Elsewhere.test', 'member')$$) = 'refused');
select pg_temp.ok('one open invite per address', pg_temp.try($$insert into miso.invitations (email, tier) values ('jane@elsewhere.test', 'member')$$) = 'refused');
select pg_temp.ok('an admin cannot change the role of an invite', pg_temp.try($$update miso.invitations set tier = 'admin' where email = 'jane@elsewhere.test'$$) = 'refused');
select pg_temp.ok('an admin cannot mark an invite accepted', pg_temp.try($$update miso.invitations set accepted_at = now() where email = 'jane@elsewhere.test'$$) = 'refused');
select pg_temp.ok('an admin cannot delete an invite', pg_temp.try($$delete from miso.invitations where email = 'jane@elsewhere.test'$$) = 'refused');
select pg_temp.ok('an admin invites a member and an admin',
  pg_temp.try($$insert into miso.invitations (email, tier) values ('revoked@elsewhere.test', 'member'), ('late@elsewhere.test', 'member'), ('lead@invites.test', 'admin')$$) = '3');
select pg_temp.ok('an admin revokes an invite', pg_temp.try($$update miso.invitations set revoked_at = now() where email = 'revoked@elsewhere.test'$$) = '1');
select pg_temp.ok('an admin cannot reopen a revoked invite', pg_temp.try($$update miso.invitations set revoked_at = null where email = 'revoked@elsewhere.test'$$) in ('0', 'refused'));
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
select pg_temp.ok('a member cannot revoke', pg_temp.try($$update miso.invitations set revoked_at = now() where email = 'jane@elsewhere.test'$$) = '0');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000008a0');
select pg_temp.ok('an owner invites an owner', pg_temp.try($$insert into miso.invitations (email, tier) values ('co-owner@elsewhere.test', 'owner')$$) = '1');
reset role;

-- Signing up.
update miso.invitations set expires_at = now() - interval '1 minute' where email = 'late@elsewhere.test';
insert into miso.allowed_domains (domain) values ('invites.test');

create temp table signed_up as
  select 'jane' as who, pg_temp.sign_up('  Jane@Elsewhere.TEST ') as id
  union all select 'revoked', pg_temp.sign_up('revoked@elsewhere.test')
  union all select 'late', pg_temp.sign_up('late@elsewhere.test')
  union all select 'stranger', pg_temp.sign_up('stranger@elsewhere.test')
  union all select 'lead', pg_temp.sign_up('lead@invites.test')
  union all select 'colleague', pg_temp.sign_up('colleague@invites.test');

select pg_temp.ok('an invited address lands active at the invite''s role, whatever its case',
  (select tier = 'manager' and status = 'active' from app.app_user where user_id = (select id from signed_up where who = 'jane')));
select pg_temp.ok('the role change credits the inviter',
  (select changed_by = '00000000-0000-0000-0000-0000000008a1' and to_tier = 'manager' and reason = 'invited'
     from app.tier_change where user_id = (select id from signed_up where who = 'jane')));
select pg_temp.ok('the invite is marked accepted', (select accepted_at is not null from miso.invitations where email = 'jane@elsewhere.test'));
select pg_temp.ok('a revoked invite lets nobody in', (select status = 'pending' and tier is null from app.app_user where user_id = (select id from signed_up where who = 'revoked')));
select pg_temp.ok('an expired invite lets nobody in', (select status = 'pending' and tier is null from app.app_user where user_id = (select id from signed_up where who = 'late')));
select pg_temp.ok('an address nobody invited waits', (select status = 'pending' from app.app_user where user_id = (select id from signed_up where who = 'stranger')));
select pg_temp.ok('an invite beats the allowed domain''s member role', (select tier = 'admin' and status = 'active' from app.app_user where user_id = (select id from signed_up where who = 'lead')));
select pg_temp.ok('an allowed domain still lets people in as members', (select tier = 'member' and status = 'active' from app.app_user where user_id = (select id from signed_up where who = 'colleague')));
rollback;
