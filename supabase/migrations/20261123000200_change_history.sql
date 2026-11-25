-- Change history: every change to a shared record, and the few shell changes people call "a change
-- in the app", in one table. It gives every space version history with no code of its own
-- (@miso/store: collection(name).history(key), .restore(key, version)), and it is what the activity
-- feed reads (GET /api/history: who changed what, when). Only adds: one table, eight functions, three
-- triggers and one nightly job.
--
--   miso.change_history         one row per change: when, who, what kind, which space, and for a
--                               record its version number and its data.
--   miso.log_record_change()    trigger on miso.records
--   miso.log_tab_change()       trigger on miso.tabs
--   miso.log_space_change()     trigger on miso.spaces
--   miso.history_actors()       display names for the people in history rows
--   miso.trim_change_history()  retention; pg_cron runs it every night.
--
-- What is logged:
--   * miso.records: every insert, update and delete. An update that leaves `data` as it was writes
--     nothing (a sync that saves the same rows every night stays quiet). Versions count up per
--     (collection, key) and go on after a delete and a new insert. A record that gets another
--     key or collection (nothing in @miso/store does that) ends as a delete under the old one and
--     starts as an insert under the new one.
--   * miso.tabs: a view opened as a tab, closed, or moved to another space. Not the Widgets tab,
--     not reordering (position) and not a tab's params: those change often and say little.
--   * miso.spaces: a space or subspace made, renamed or deleted by a person. Not the icon, the
--     look or the position.
--   * Left out on purpose: miso.space_layouts (every drag and resize on a dashboard saves the whole
--     grid, and the active tab is stored there too, so it would flood the feed), connectors and
--     space access (admin pages with their own columns for who and when), and members
--     (app.tier_change already keeps who changed whose role).
--
-- Who did it (actor):
--   * The shell writes tabs and spaces as the signed-in person, so the actor is auth.uid(). What
--     the service accounts write there (the sync from spaces.json, the first tabs of a new space)
--     is not a person's change and is not logged.
--   * Space code writes records as the spaces service account, not as the member who clicked. So
--     @miso/store sends the member's id in the request header `x-miso-caller` (the shell puts it
--     in the call's env, see app/server/rpc.ts), and the trigger takes it from there, but only
--     when the session is a service account and the id is a real account. Anyone else's header is
--     ignored: a member writing through the API with their own session is logged as themself.
--     A write with no member behind it (a scheduled job, local miso) is logged as the service
--     account, and the feed shows it as automatic.
--   * actor is null for a write with nobody signed in (the database password, the secret key),
--     and turns null when the account is deleted.
--
-- Who sees a row: the same people who see the record. A row carries the record's space; a record
-- with no space is every member's, as in the records policy. When a record moves to another space
-- its history moves with it. Rows of a space that no longer exists stay for owners only: there is
-- no foreign key to miso.spaces, so logging can never make a delete fail, and without one
-- sees_space() alone would show those rows to everyone. Nobody inserts, updates or deletes rows
-- through the API, not with the secret key either; only the triggers write.
--
-- Row size: `data` is the record's full data after the change (for a delete: the data that was
-- deleted), not a diff and not before plus after. Restoring needs the whole value, the version
-- before is the "before", and storing both would double every row. The cost is one copy of the
-- record per change, so a big record saved often grows the table fast. Retention bounds that: 400
-- days (a full year plus a month, so "what did this look like at this time last year" works), and
-- at most the newest 200 versions per record. The first change to a record that was there before
-- this migration also saves what it held until then, as a 'snapshot' row, so that change can be
-- undone too. The feed leaves snapshots out.

create table miso.change_history (
  id bigint generated always as identity,
  at timestamp with time zone default now() not null,
  actor uuid,
  source text not null,
  action text not null,
  space_id text,
  collection text,
  key text not null,
  version integer,
  label text,
  data jsonb,
  constraint change_history_pkey primary key (id),
  constraint change_history_actor_fkey foreign key (actor) references auth.users (id) on delete set null,
  constraint change_history_source_known check (source = any (array['record'::text, 'tab'::text, 'space'::text])),
  constraint change_history_action_known check (action = any (array['insert'::text, 'update'::text, 'delete'::text, 'snapshot'::text])),
  constraint change_history_record_shape check ((source = 'record') = (collection is not null and version is not null))
);

comment on table miso.change_history is
  'Version history of miso.records and the activity feed. Written only by triggers; see 20261123000200_change_history.sql.';
comment on column miso.change_history.source is 'record (miso.records), tab (miso.tabs) or space (miso.spaces)';
comment on column miso.change_history.key is 'The record key, the tab ref (view:<folder>/<view>) or the space id';
comment on column miso.change_history.label is 'A readable name: the record''s title, name or label when its data has one; the space''s name';
comment on column miso.change_history.data is 'record: the data after the change, or the deleted data. tab and space: {"from": ...} on a move or rename';

-- One record's versions, newest first (history, restore, the next version number). Unique: two
-- writes to one record wait for each other on the record's row, so a clash can't happen.
create unique index change_history_record_version_key on miso.change_history using btree (collection, key, version)
  where source = 'record';
-- The feed for one space; the feed for all spaces walks the primary key backwards.
create index change_history_space_id_idx on miso.change_history using btree (space_id, id desc);
-- The foreign key (deleting an account clears its rows' actor) and the names lookup.
create index change_history_actor_idx on miso.change_history using btree (actor);
-- Retention deletes by age.
create index change_history_at_idx on miso.change_history using btree (at);

alter table miso.change_history enable row level security;

create policy change_history_select_visible on miso.change_history as permissive for select to authenticated
  using (
    (select miso.is_member())
    and miso.sees_space(space_id)
    and (
      space_id is null
      or (select app.has_at_least('owner'::app.tier))
      or exists (select 1 from miso.spaces s where s.id = change_history.space_id)
    )
  );

-- No insert, update or delete policy and no such grant: the triggers below are the only writers.
revoke all on miso.change_history from anon, authenticated;
grant select on miso.change_history to authenticated;
grant select on miso.change_history to service_role;

-- Who is behind the current write, and whether the session is one of the app's service accounts
-- (app_metadata.miso_service, which only the Auth admin API sets; see miso.sees_space). A service
-- account may name the member it works for in the x-miso-caller header; nobody else may.
create function miso.change_writer(out actor uuid, out service boolean)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_caller text;
begin
  -- Only an id that is an account: change_history.actor references auth.users, and a token whose
  -- user is gone must not make the write it logs fail.
  select u.id, coalesce(u.raw_app_meta_data ->> 'miso_service' = 'true', false) into actor, service
    from auth.users u where u.id = v_uid;
  service := coalesce(service, false);
  if service then
    v_caller := lower(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-miso-caller');
    if v_caller ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      actor := coalesce((select a.user_id from app.app_user a where a.user_id = v_caller::uuid), v_uid);
    end if;
  end if;
end
$fn$;

revoke all on function miso.change_writer() from public, anon, authenticated;

-- Writes one version of a record: the next number for its (collection, key). p_before_at set means
-- the record was there before this change; when it has no history yet (a record from before this
-- table), what it held until now is kept first, as version 1.
create function miso.add_record_version(p_action text, p_row miso.records, p_actor uuid, p_before jsonb, p_before_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_version integer;
begin
  select coalesce(max(h.version), 0) into v_version
    from miso.change_history h
   where h.source = 'record' and h.collection = p_row.collection and h.key = p_row.key;

  if v_version = 0 and p_before_at is not null then
    v_version := 1;
    insert into miso.change_history (at, actor, source, action, space_id, collection, key, version, label, data)
    values (p_before_at, null, 'record', 'snapshot', p_row.space_id, p_row.collection, p_row.key, 1, miso.record_label(p_before), p_before);
  end if;

  insert into miso.change_history (actor, source, action, space_id, collection, key, version, label, data)
  values (p_actor, 'record', p_action, p_row.space_id, p_row.collection, p_row.key, v_version + 1, miso.record_label(p_row.data), p_row.data);
end
$fn$;

revoke all on function miso.add_record_version(text, miso.records, uuid, jsonb, timestamp with time zone) from public, anon, authenticated;

create function miso.log_record_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid;
  v_renamed boolean := false;
begin
  if tg_op = 'UPDATE' then
    -- The history goes where the record goes, so the people who see the one see the other.
    if new.space_id is distinct from old.space_id then
      update miso.change_history h
         set space_id = new.space_id
       where h.source = 'record' and h.collection = old.collection and h.key = old.key
         and h.space_id is distinct from new.space_id;
    end if;
    v_renamed := new.collection <> old.collection or new.key <> old.key;
    if new.data = old.data and not v_renamed then
      return null;
    end if;
  end if;

  select w.actor into v_actor from miso.change_writer() w;
  if tg_op = 'INSERT' then
    perform miso.add_record_version('insert', new, v_actor, null, null);
  elsif tg_op = 'DELETE' then
    perform miso.add_record_version('delete', old, v_actor, old.data, old.updated_at);
  elsif v_renamed then
    -- Another key or collection: the old one's versions end here, the new one's start (or go on,
    -- when a record with that key was there before).
    perform miso.add_record_version('delete', old, v_actor, old.data, old.updated_at);
    perform miso.add_record_version('insert', new, v_actor, null, null);
  else
    perform miso.add_record_version('update', new, v_actor, old.data, old.updated_at);
  end if;
  return null;
end
$fn$;

-- What to call a record in the feed: its own title, name or label, when its data has one as text.
create function miso.record_label(p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select nullif(btrim(left(coalesce(
    case when jsonb_typeof(p_data -> 'title') = 'string' then nullif(btrim(p_data ->> 'title'), '') end,
    case when jsonb_typeof(p_data -> 'name') = 'string' then nullif(btrim(p_data ->> 'name'), '') end,
    case when jsonb_typeof(p_data -> 'label') = 'string' then nullif(btrim(p_data ->> 'label'), '') end
  ), 200)), '')
$fn$;

revoke all on function miso.record_label(jsonb) from public, anon, authenticated;

create function miso.log_tab_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row miso.tabs;
  v_actor uuid;
  v_service boolean;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  if v_row.ref not like 'view:%' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.space_id = old.space_id then
    return null;
  end if;
  select w.actor, w.service into v_actor, v_service from miso.change_writer() w;
  if v_actor is null or v_service then
    return null;
  end if;
  -- Tabs that go because their space was deleted: the space's own row says it.
  if tg_op = 'DELETE' and not exists (select 1 from miso.spaces s where s.id = old.space_id) then
    return null;
  end if;
  insert into miso.change_history (actor, source, action, space_id, key, data)
  values (
    v_actor, 'tab', lower(tg_op), v_row.space_id, v_row.ref,
    case when tg_op = 'UPDATE' then jsonb_build_object('from', old.space_id) end
  );
  return null;
end
$fn$;

create function miso.log_space_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_row miso.spaces;
  v_actor uuid;
  v_service boolean;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  if tg_op = 'UPDATE' and new.name = old.name then
    return null;
  end if;
  select w.actor, w.service into v_actor, v_service from miso.change_writer() w;
  if v_actor is null or v_service then
    return null;
  end if;
  insert into miso.change_history (actor, source, action, space_id, key, label, data)
  values (
    v_actor, 'space', lower(tg_op), v_row.id, v_row.id, v_row.name,
    case when tg_op = 'UPDATE' then jsonb_build_object('from', old.name) end
  );
  return null;
end
$fn$;

revoke all on function miso.log_record_change() from public, anon, authenticated;
revoke all on function miso.log_tab_change() from public, anon, authenticated;
revoke all on function miso.log_space_change() from public, anon, authenticated;

create trigger records_history after insert or update or delete on miso.records
  for each row execute function miso.log_record_change();
create trigger tabs_history after insert or delete or update of space_id on miso.tabs
  for each row execute function miso.log_tab_change();
create trigger spaces_history after insert or delete or update of name on miso.spaces
  for each row execute function miso.log_space_change();

-- Names for the feed. A member can't read app.app_user (only their own row), so this hands out the
-- display name of people who appear in the history, and nothing else about them. The email comes
-- along only for admins and owners, who see every email on the Members page anyway. `automatic`
-- marks the service accounts.
create function miso.history_actors(p_ids uuid[])
returns table (user_id uuid, name text, email text, automatic boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select u.id,
         a.display_name,
         case when app.has_at_least('admin'::app.tier) then a.email end,
         coalesce(u.raw_app_meta_data ->> 'miso_service' = 'true', false)
    from auth.users u
    left join app.app_user a on a.user_id = u.id
   where miso.is_member()
     and cardinality(p_ids) <= 500
     and u.id = any (p_ids)
     and exists (select 1 from miso.change_history h where h.actor = u.id)
$fn$;

revoke all on function miso.history_actors(uuid[]) from public, anon;
grant execute on function miso.history_actors(uuid[]) to authenticated;

-- Retention: 400 days, and the newest 200 versions of each record.
create function miso.trim_change_history()
returns void
language sql
security definer
set search_path = ''
as $fn$
  delete from miso.change_history where at < now() - interval '400 days';
  delete from miso.change_history h
   using (
     select c.collection, c.key, max(c.version) as latest
       from miso.change_history c
      where c.source = 'record'
      group by c.collection, c.key
     having count(*) > 200
   ) m
   where h.source = 'record' and h.collection = m.collection and h.key = m.key and h.version <= m.latest - 200;
$fn$;

revoke all on function miso.trim_change_history() from public, anon, authenticated;

-- Every night at 04:15 UTC, where pg_cron is available (Supabase has it, local and hosted).
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('miso_change_history_trim', '15 4 * * *', 'select miso.trim_change_history()');
  end if;
end
$do$;
