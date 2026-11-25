-- Hidden spaces stay hidden in the database too. The API already leaves out spaces someone's
-- tier doesn't see (app/lib/access.ts), but spaces, tabs, space_layouts and records only asked
-- for is_member(), so PostgREST and Realtime handed every member every space's rows.

-- spaces.json `minTier`, written by miso.sync_spaces() below. The database needs it for a space
-- without a rule on the Space access page.
alter table miso.spaces add column min_tier app.tier;

-- Whether the caller sees a space: app/lib/access.ts seesSpace(), in SQL. Owners see every space;
-- a Space access rule names the tiers that see it; without a rule, spaces.json's minTier does. The
-- service accounts (miso.members: space code and the vault) see every space, as space code did
-- before. Records with no space, and spaces the database doesn't know, stay visible.
CREATE OR REPLACE FUNCTION miso.sees_space(p_space text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_space is null
    or exists (select 1 from miso.members m where m.user_id = auth.uid())
    or app.has_at_least('owner'::app.tier)
    or coalesce(
      (select coalesce(app.current_tier() = any(a.tiers), false) from miso.space_access a where a.space_id = p_space),
      (select s.min_tier is null or app.has_at_least(s.min_tier) from miso.spaces s where s.id = p_space),
      true
    )
$function$;

revoke all on function miso.sees_space(text) from public;
grant execute on function miso.sees_space(text) to authenticated;

drop policy "members use spaces" on miso.spaces;
drop policy "members use tabs" on miso.tabs;
drop policy "members use layouts" on miso.space_layouts;
drop policy "members use records" on miso.records;
create policy "members use spaces they see" on miso.spaces as permissive for all to authenticated
  using (miso.is_member() and miso.sees_space(id)) with check (miso.is_member() and miso.sees_space(id));
create policy "members use tabs they see" on miso.tabs as permissive for all to authenticated
  using (miso.is_member() and miso.sees_space(space_id)) with check (miso.is_member() and miso.sees_space(space_id));
create policy "members use layouts they see" on miso.space_layouts as permissive for all to authenticated
  using (miso.is_member() and miso.sees_space(space_id)) with check (miso.is_member() and miso.sees_space(space_id));
create policy "members use records they see" on miso.records as permissive for all to authenticated
  using (miso.is_member() and miso.sees_space(space_id)) with check (miso.is_member() and miso.sees_space(space_id));

-- Spaces come from spaces.json, and only the server's vault account writes what it says. A member
-- can't, or they would clear min_tier. Inserts the new spaces and returns their ids; for the rest,
-- takes slug, folder, previous slugs, icon and minTier from the catalog. A slug or folder that
-- another space holds (one dropped from spaces.json, or two spaces swapping) is freed first, so
-- the unique keys never fail the sync.
CREATE OR REPLACE FUNCTION miso.sync_spaces(p_spaces jsonb)
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not miso.is_service() then
    raise exception 'only the miso service account syncs spaces' using errcode = '42501';
  end if;
  update miso.spaces s
     set slug = 'freed-' || substr(md5(s.id), 1, 12),
         folder = null
   where exists (
     select 1 from jsonb_to_recordset(p_spaces) as w(id text, slug text, folder text)
      where w.id <> s.id and (w.slug = s.slug or w.folder = s.folder)
   );
  return query
    with saved as (
      insert into miso.spaces as s (id, slug, name, folder, previous_slugs, "position", theme, icon, min_tier)
      select w.id, w.slug, w.name, w.folder, coalesce(w.previous_slugs, '{}'), coalesce(w."position", 0),
             coalesce(w.theme, '{}'), w.icon, w.min_tier
        from jsonb_to_recordset(p_spaces) as w(
          id text, slug text, name text, folder text, previous_slugs text[], "position" integer,
          theme jsonb, icon text, min_tier app.tier
        )
      on conflict (id) do update
         set slug = excluded.slug,
             folder = excluded.folder,
             previous_slugs = excluded.previous_slugs,
             icon = excluded.icon,
             min_tier = excluded.min_tier
       where (s.slug, s.folder, s.previous_slugs, s.icon, s.min_tier)
             is distinct from (excluded.slug, excluded.folder, excluded.previous_slugs, excluded.icon, excluded.min_tier)
      -- xmax is 0 only on a row this statement inserted.
      returning s.id, s.xmax = 0 as inserted
    )
    select saved.id from saved where saved.inserted;
end
$function$;

revoke all on function miso.sync_spaces(jsonb) from public;
grant execute on function miso.sync_spaces(jsonb) to authenticated;

-- An admin changes the rule of a space admins see, and leaves admins in it. Only an owner opens an
-- owners-only space, or takes admins off one.
drop policy space_access_delete_admin on miso.space_access;
drop policy space_access_insert_admin on miso.space_access;
drop policy space_access_update_admin on miso.space_access;
create policy space_access_delete_admin on miso.space_access as permissive for delete to authenticated
  using (app.has_at_least('owner'::app.tier) or (app.has_at_least('admin'::app.tier) and 'admin'::app.tier = any(tiers)));
create policy space_access_insert_admin on miso.space_access as permissive for insert to authenticated
  with check (app.has_at_least('owner'::app.tier)
    or (app.has_at_least('admin'::app.tier) and 'admin'::app.tier = any(tiers) and miso.sees_space(space_id)));
create policy space_access_update_admin on miso.space_access as permissive for update to authenticated
  using (app.has_at_least('owner'::app.tier) or (app.has_at_least('admin'::app.tier) and 'admin'::app.tier = any(tiers)))
  with check (app.has_at_least('owner'::app.tier) or (app.has_at_least('admin'::app.tier) and 'admin'::app.tier = any(tiers)));
