-- Allowed domains (20261122000000_allowed_domains_admins): owners and admins add and remove a
-- domain, a member and an account still waiting for a role cannot. Runs in one transaction and
-- rolls it back, so it changes nothing.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/checks/allowed-domains.sql
--
-- Expected: every line starts with `ok`. A line starting with `FAIL` names what broke.
begin;

-- The owner first: on a fresh database the first account becomes the owner, and the last owner
-- can't be demoted.
insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a0', 'owner@domains.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000007a1', 'admin@domains.test',  now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000007a2', 'member@domains.test', now(), 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000007a3', 'nobody@domains.test', now(), 'authenticated', 'authenticated', '{}');
set local app.actor_id = '00000000-0000-0000-0000-0000000007a0';
update app.app_user set tier = 'owner',  status = 'active' where email = 'owner@domains.test';
update app.app_user set tier = 'admin',  status = 'active' where email = 'admin@domains.test';
update app.app_user set tier = 'member', status = 'active' where email = 'member@domains.test';

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

select pg_temp.ok('the fourth account is waiting for a role',
  (select status = 'pending' from app.app_user where email = 'nobody@domains.test'));
select pg_temp.ok('the check domains are not listed yet',
  not exists (select 1 from miso.allowed_domains where domain in ('owner.allowed-domains.test', 'admin.allowed-domains.test')));

-- The same statements for everyone, so a refusal means row level security and not a typo.
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a2');
select pg_temp.ok('a member cannot add a domain', pg_temp.try($$insert into miso.allowed_domains (domain) values ('owner.allowed-domains.test')$$) = 'refused');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a3');
select pg_temp.ok('a waiting account cannot add a domain', pg_temp.try($$insert into miso.allowed_domains (domain) values ('owner.allowed-domains.test')$$) = 'refused');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000007a0');
select pg_temp.ok('an owner adds a domain', pg_temp.try($$insert into miso.allowed_domains (domain) values ('owner.allowed-domains.test')$$) = '1');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a1');
select pg_temp.ok('an admin adds a domain', pg_temp.try($$insert into miso.allowed_domains (domain) values ('admin.allowed-domains.test')$$) = '1');
select pg_temp.ok('an admin reads the list', (select count(*) from miso.allowed_domains where domain like '%.allowed-domains.test') = 2);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-0000000007a2');
select pg_temp.ok('a member reads the list', (select count(*) from miso.allowed_domains where domain like '%.allowed-domains.test') = 2);
select pg_temp.ok('a member cannot remove a domain', pg_temp.try($$delete from miso.allowed_domains where domain = 'owner.allowed-domains.test'$$) = '0');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a3');
select pg_temp.ok('a waiting account reads nothing', (select count(*) from miso.allowed_domains) = 0);
select pg_temp.ok('a waiting account cannot remove a domain', pg_temp.try($$delete from miso.allowed_domains where domain = 'owner.allowed-domains.test'$$) = '0');
reset role;
select pg_temp.ok('both domains are still there', (select count(*) from miso.allowed_domains where domain like '%.allowed-domains.test') = 2);

select pg_temp.as_user('00000000-0000-0000-0000-0000000007a1');
select pg_temp.ok('an admin removes a domain', pg_temp.try($$delete from miso.allowed_domains where domain = 'owner.allowed-domains.test'$$) = '1');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000007a0');
select pg_temp.ok('an owner removes a domain', pg_temp.try($$delete from miso.allowed_domains where domain = 'admin.allowed-domains.test'$$) = '1');
reset role;
select pg_temp.ok('both domains are gone', not exists (select 1 from miso.allowed_domains where domain like '%.allowed-domains.test'));
rollback;
