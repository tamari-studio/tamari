-- Usage analytics: who writes and reads miso.usage_events and miso.usage_report(). Runs in one
-- transaction and rolls it back, so it changes nothing. Stops at the first failed expectation
-- (each prints FAIL and why); the last line says all passed.
--
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/checks/usage-events.sql
--
-- On a database where the migrations after 20261020000000 haven't run yet, add `-v unapplied=1`
-- to run them inside the transaction first.
\set ON_ERROR_STOP 1
begin;
\if :{?unapplied}
\ir ../migrations/20261021000000_audit_fixes.sql
\ir ../migrations/20261022000000_hidden_spaces.sql
\ir ../migrations/20261022000100_connectors_admin.sql
\ir ../migrations/20261022000200_spaces_position.sql
\ir ../migrations/20261022000300_sees_space_service_only.sql
\ir ../migrations/20261022000400_sees_space_service_marker.sql
\ir ../migrations/20261023000000_usage_events.sql
\endif

-- An owner, an admin and a member, all active; a space everyone sees and one only owners see.
insert into auth.users (id, email, email_confirmed_at, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'usage-owner@x.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'usage-admin@x.test', now(), 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'usage-member@x.test', now(), 'authenticated', 'authenticated');
set local app.actor_id = '00000000-0000-0000-0000-0000000000c1';
update app.app_user set status = 'active', tier = 'owner' where email = 'usage-owner@x.test';
update app.app_user set status = 'active', tier = 'admin' where email = 'usage-admin@x.test';
update app.app_user set status = 'active', tier = 'member' where email = 'usage-member@x.test';
insert into miso.spaces (id, slug, name) values ('usage-open', 'usage-open', 'Open'), ('usage-secret', 'usage-secret', 'Secret');
update miso.spaces set min_tier = 'owner' where id = 'usage-secret';

-- Events the owner made, written as the database owner: one in the secret space, and one from
-- 100 days ago that the trim deletes.
insert into miso.usage_events (user_id, session_id, kind, space_id, target) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', 'view', 'usage-secret', 'view:secret/plans');
insert into miso.usage_events (user_id, at, session_id, kind, target) values
  ('00000000-0000-0000-0000-0000000000c1', now() - interval '100 days', '00000000-0000-0000-0000-0000000000d1', 'session', 'start');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('role', 'authenticated', true) $$;

-- The member ------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');

insert into miso.usage_events (session_id, kind, target) values ('00000000-0000-0000-0000-0000000000d3', 'session', 'start');
insert into miso.usage_events (session_id, kind, space_id, target)
  values ('00000000-0000-0000-0000-0000000000d3', 'view', 'usage-open', 'widgets');
insert into miso.usage_events (session_id, kind, target) values ('00000000-0000-0000-0000-0000000000d3', 'action', 'tab.open');

do $$ begin
  insert into miso.usage_events (session_id, kind, space_id, target)
    values ('00000000-0000-0000-0000-0000000000d3', 'view', 'usage-secret', 'widgets');
  raise exception 'FAIL: a member logged an event in a space they do not see';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  insert into miso.usage_events (user_id, session_id, kind, target)
    values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d3', 'session', 'start');
  raise exception 'FAIL: a member logged an event as someone else';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  insert into miso.usage_events (at, session_id, kind, target)
    values (now() - interval '1 day', '00000000-0000-0000-0000-0000000000d3', 'session', 'start');
  raise exception 'FAIL: a member backdated an event';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  insert into miso.usage_events (session_id, kind, target) values ('00000000-0000-0000-0000-0000000000d3', 'search', 'start');
  raise exception 'FAIL: an unknown kind was stored';
exception when check_violation then null;
end $$;

do $$ begin
  insert into miso.usage_events (session_id, kind, target) values ('00000000-0000-0000-0000-0000000000d3', 'view', 'page:members?q=sam');
  raise exception 'FAIL: a target with a query string was stored';
exception when check_violation then null;
end $$;

do $$ begin
  if (select count(*) from miso.usage_events) <> 0 then
    raise exception 'FAIL: a member read raw usage events';
  end if;
end $$;

do $$ begin
  perform miso.usage_report(30, 'Europe/Copenhagen');
  raise exception 'FAIL: a member read the usage report';
exception when insufficient_privilege then null;
end $$;

do $$ begin
  perform miso.trim_usage_events();
  raise exception 'FAIL: a member ran the trim';
exception when insufficient_privilege then null;
end $$;
reset role;

-- The admin -------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into miso.usage_events (session_id, kind, space_id, target)
  values ('00000000-0000-0000-0000-0000000000d2', 'view', 'usage-open', 'widgets'),
         ('00000000-0000-0000-0000-0000000000d2', 'view', null, 'page:members');

do $$
declare r jsonb := miso.usage_report(30, 'Europe/Copenhagen');
begin
  if (select count(*) from miso.usage_events) <> 0 then
    raise exception 'FAIL: an admin read raw usage events';
  end if;
  if r -> 'members' <> 'null'::jsonb then
    raise exception 'FAIL: an admin got the per-member list: %', r -> 'members';
  end if;
  if r::text like '%usage-secret%' or r::text like '%view:secret/plans%' then
    raise exception 'FAIL: the secret space leaked into an admin''s report: %', r;
  end if;
  if (r -> 'active' ->> 'today')::int <> 2 then
    raise exception 'FAIL: expected 2 active today (member, admin) for the admin, got %', r -> 'active';
  end if;
  if (select (s ->> 'views')::int from jsonb_array_elements(r -> 'spaces') s where s ->> 'spaceId' = 'usage-open') <> 2 then
    raise exception 'FAIL: expected 2 views of the open space, got %', r -> 'spaces';
  end if;
  if (select (s ->> 'users')::int from jsonb_array_elements(r -> 'tabs') s where s ->> 'target' = 'widgets') <> 2 then
    raise exception 'FAIL: expected 2 people on the open widgets tab, got %', r -> 'tabs';
  end if;
  if (select (s ->> 'views')::int from jsonb_array_elements(r -> 'pages') s where s ->> 'target' = 'page:members') <> 1 then
    raise exception 'FAIL: expected 1 Members page view, got %', r -> 'pages';
  end if;
  if (select (s ->> 'count')::int from jsonb_array_elements(r -> 'actions') s where s ->> 'target' = 'tab.open') <> 1 then
    raise exception 'FAIL: expected 1 tab.open, got %', r -> 'actions';
  end if;
  if jsonb_array_length(r -> 'daily') <> 30 then
    raise exception 'FAIL: expected 30 days in the daily series, got %', jsonb_array_length(r -> 'daily');
  end if;
  if (r -> 'daily' -> 29 ->> 'users')::int <> 2 or (r -> 'daily' -> 0 ->> 'users')::int <> 0 then
    raise exception 'FAIL: daily series is off: first % last %', r -> 'daily' -> 0, r -> 'daily' -> 29;
  end if;
  if (r ->> 'days')::int <> 30 or (miso.usage_report(1000, 'UTC') ->> 'days')::int <> 90 then
    raise exception 'FAIL: the window is not clamped to 1..90 days';
  end if;
end $$;
reset role;

-- The owner -------------------------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
do $$
declare
  r jsonb := miso.usage_report(7, 'UTC');
  m jsonb;
begin
  if (select count(*) from miso.usage_events) < 6 then
    raise exception 'FAIL: the owner can''t read raw usage events';
  end if;
  if (select (s ->> 'views')::int from jsonb_array_elements(r -> 'spaces') s where s ->> 'spaceId' = 'usage-secret') <> 1 then
    raise exception 'FAIL: the owner should see the secret space''s view, got %', r -> 'spaces';
  end if;
  if (r -> 'active' ->> 'today')::int <> 3 then
    raise exception 'FAIL: expected 3 active today for the owner, got %', r -> 'active';
  end if;
  select x into m from jsonb_array_elements(r -> 'members') x where x ->> 'email' = 'usage-member@x.test';
  if m is null or m ->> 'lastSeenAt' is null then
    raise exception 'FAIL: the owner has no last-seen for the member: %', r -> 'members';
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'members') x where x ->> 'email' like 'miso-%@example.com') then
    raise exception 'FAIL: the service accounts are in the member list';
  end if;
  if (select count(*) from jsonb_object_keys(m)) <> 6 then
    raise exception 'FAIL: the member list holds more than last-seen: %', m;
  end if;
end $$;
reset role;

-- Retention, and the nightly job ----------------------------------------------------------------
select miso.trim_usage_events();
do $$ begin
  if exists (select 1 from miso.usage_events where at < now() - interval '90 days') then
    raise exception 'FAIL: the trim left events older than 90 days';
  end if;
  if (select count(*) from miso.usage_events where user_id::text like '00000000-0000-0000-0000-0000000000c%') <> 6 then
    raise exception 'FAIL: the trim deleted recent events';
  end if;
  if not exists (select 1 from cron.job where jobname = 'miso_usage_events_trim' and command = 'select miso.trim_usage_events()') then
    raise exception 'FAIL: the nightly trim is not scheduled';
  end if;
end $$;

-- Deleting an account deletes its events.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c3';
do $$ begin
  if exists (select 1 from miso.usage_events where user_id = '00000000-0000-0000-0000-0000000000c3') then
    raise exception 'FAIL: a deleted account''s events were kept';
  end if;
end $$;

select 'usage-events check: all passed';
rollback;
