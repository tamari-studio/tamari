-- Usage analytics: which spaces, tabs and pages people open and what they do there, so owners and
-- admins can see how the app is used. First party: the rows stay in this database, and no outside
-- analytics service is involved.
--
--   miso.usage_events        one row per event: who (the signed-in account), when, which session,
--                            what kind, which space, and a short target id. Nothing else.
--   miso.usage_report()      the Usage page's numbers, for admins and owners.
--   miso.trim_usage_events() deletes events older than 90 days; pg_cron runs it every night.
--
-- Who sees what:
--   * Everyone signed in writes only their own events (user_id and at are stamped here, and the
--     browser can't set them), and only for spaces they see.
--   * Nobody reads raw rows through the API except owners.
--   * Admins and owners read the totals through miso.usage_report(). It counts only events in
--     spaces the caller sees (miso.sees_space), so a hidden space doesn't show up in the numbers.
--   * Only owners get the per-member list, and it holds just each member's last-seen time: the
--     same thing the Members page already shows owners (app.user_activity).
--
-- target is an id the app knows, never free text or a URL: a tab ref ('widgets',
-- 'view:<folder>/<view>'), a workspace page ('page:members'), an action ('tab.open') or 'start'
-- for a session. The API checks each one against the build's catalog before it gets here.

create table miso.usage_events (
  id bigint generated always as identity,
  at timestamp with time zone default now() not null,
  user_id uuid default auth.uid() not null,
  session_id uuid not null,
  kind text not null,
  space_id text,
  target text not null,
  constraint usage_events_pkey primary key (id),
  constraint usage_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint usage_events_kind_known check (kind = any (array['session'::text, 'view'::text, 'action'::text])),
  constraint usage_events_target_id check (target ~ '^[A-Za-z0-9:/._-]{1,200}$'),
  constraint usage_events_space_id_length check (char_length(space_id) between 1 and 200)
);

-- The report scans a date range; last seen reads one member's latest event.
create index usage_events_at_idx on miso.usage_events using btree (at);
create index usage_events_user_id_at_idx on miso.usage_events using btree (user_id, at desc);

alter table miso.usage_events enable row level security;

create policy usage_events_insert_own on miso.usage_events as permissive for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select miso.is_member())
    and (space_id is null or miso.sees_space(space_id))
  );
create policy usage_events_select_owner on miso.usage_events as permissive for select to authenticated
  using ((select app.has_at_least('owner'::app.tier)));

revoke all on miso.usage_events from anon, authenticated;
-- Not user_id or at: the defaults stamp them, so nobody can log an event as someone else.
grant insert (session_id, kind, space_id, target) on miso.usage_events to authenticated;
grant select on miso.usage_events to authenticated;
grant select, insert, delete on miso.usage_events to service_role;

-- The Usage page. p_days is the window (1 to 90 days, ending today); p_tz is the caller's time
-- zone, so "a day" is their day. Security definer so it can count events admins can't select, but
-- it checks the caller first and leaves out spaces the caller doesn't see.
CREATE OR REPLACE FUNCTION miso.usage_report(p_days integer DEFAULT 30, p_tz text DEFAULT 'UTC')
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 90);
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v_today date;
  v_from date;
  v_since timestamptz;
  v_owner boolean;
  v_report jsonb;
begin
  if not (miso.is_member() and app.has_at_least('admin'::app.tier)) then
    raise exception 'Only admins and owners see usage.' using errcode = '42501';
  end if;
  v_owner := app.has_at_least('owner'::app.tier);
  v_today := (now() at time zone v_tz)::date;
  v_from := v_today - (v_days - 1);
  -- The 30-day active count needs 30 days even when the window is shorter.
  v_since := (least(v_from, v_today - 29)::timestamp) at time zone v_tz;

  with visible as (
    select s.id, s.name from miso.spaces s where miso.sees_space(s.id)
  ),
  ev as (
    select e.user_id, e.session_id, e.kind, e.space_id, e.target, (e.at at time zone v_tz)::date as day
      from miso.usage_events e
     where e.at >= v_since
       and (e.space_id is null or e.space_id in (select v.id from visible v))
  ),
  win as (
    select * from ev where ev.day >= v_from
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_today,
    'days', v_days,
    'active', jsonb_build_object(
      'today', (select count(distinct ev.user_id) from ev where ev.day = v_today),
      'week', (select count(distinct ev.user_id) from ev where ev.day > v_today - 7),
      'month', (select count(distinct ev.user_id) from ev where ev.day > v_today - 30)
    ),
    'totals', (
      select jsonb_build_object('users', count(distinct win.user_id), 'sessions', count(distinct win.session_id), 'events', count(*))
        from win
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day::date,
               'users', coalesce(x.users, 0),
               'sessions', coalesce(x.sessions, 0),
               'events', coalesce(x.events, 0)
             ) order by d.day), '[]'::jsonb)
        from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') as d(day)
        left join (
          select win.day, count(distinct win.user_id) as users, count(distinct win.session_id) as sessions, count(*) as events
            from win group by win.day
        ) x on x.day = d.day::date
    ),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week', w.week, 'users', w.users) order by w.week), '[]'::jsonb)
        from (
          select date_trunc('week', win.day::timestamp)::date as week, count(distinct win.user_id) as users
            from win group by 1
        ) w
    ),
    'spaces', (
      select coalesce(jsonb_agg(jsonb_build_object('spaceId', t.space_id, 'name', t.name, 'views', t.views, 'users', t.users)
               order by t.views desc, t.space_id), '[]'::jsonb)
        from (
          select win.space_id, v.name, count(*) as views, count(distinct win.user_id) as users
            from win join visible v on v.id = win.space_id
           where win.kind = 'view'
           group by win.space_id, v.name
           order by views desc, win.space_id
           limit 50
        ) t
    ),
    'tabs', (
      select coalesce(jsonb_agg(jsonb_build_object('spaceId', t.space_id, 'target', t.target, 'views', t.views, 'users', t.users)
               order by t.views desc, t.space_id, t.target), '[]'::jsonb)
        from (
          select win.space_id, win.target, count(*) as views, count(distinct win.user_id) as users
            from win
           where win.kind = 'view' and win.space_id is not null
           group by win.space_id, win.target
           order by views desc, win.space_id, win.target
           limit 100
        ) t
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('target', t.target, 'views', t.views, 'users', t.users)
               order by t.views desc, t.target), '[]'::jsonb)
        from (
          select win.target, count(*) as views, count(distinct win.user_id) as users
            from win where win.kind = 'view' and win.space_id is null
           group by win.target
        ) t
    ),
    'actions', (
      select coalesce(jsonb_agg(jsonb_build_object('target', t.target, 'count', t.n, 'users', t.users)
               order by t.n desc, t.target), '[]'::jsonb)
        from (
          select win.target, count(*) as n, count(distinct win.user_id) as users
            from win where win.kind = 'action'
           group by win.target
        ) t
    ),
    -- Owners only, and only the last-seen time: the most recent event or activity ping, from
    -- all time rather than the window. Leaves out the service accounts.
    'members', case when v_owner then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'userId', m.user_id, 'email', m.email, 'name', m.display_name, 'tier', m.tier, 'status', m.status,
               'lastSeenAt', m.last_seen
             ) order by m.last_seen desc nulls last, m.email), '[]'::jsonb)
        from (
          select u.user_id, u.email, u.display_name, u.tier, u.status,
                 nullif(greatest(
                   coalesce((select max(e.at) from miso.usage_events e where e.user_id = u.user_id), '-infinity'::timestamptz),
                   coalesce(a.last_active_at, '-infinity'::timestamptz)
                 ), '-infinity'::timestamptz) as last_seen
            from app.app_user u
            left join app.user_activity a on a.user_id = u.user_id
           where not exists (
             select 1 from auth.users x where x.id = u.user_id and x.raw_app_meta_data ->> 'miso_service' = 'true'
           )
        ) m
    ) end
  ) into v_report;
  return v_report;
end
$function$;

revoke all on function miso.usage_report(integer, text) from public;
grant execute on function miso.usage_report(integer, text) to authenticated;

-- Retention: 90 days, the longest window the report shows.
CREATE OR REPLACE FUNCTION miso.trim_usage_events()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  delete from miso.usage_events where at < now() - interval '90 days'
$function$;

revoke all on function miso.trim_usage_events() from public, anon, authenticated;

-- Every night at 03:45 UTC, where pg_cron is available (Supabase has it, local and hosted).
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('miso_usage_events_trim', '45 3 * * *', 'select miso.trim_usage_events()');
  end if;
end
$do$;
