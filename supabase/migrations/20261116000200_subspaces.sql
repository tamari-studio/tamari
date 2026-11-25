-- Subspaces: a space can hold child spaces, one level deep, each with its own tabs and widget grid.
-- A child is an ordinary row in miso.spaces with parent_id set and no folder, so tabs, layouts,
-- records, move_tab, move_widget and Realtime work on it unchanged, and one view can be a tab in
-- the parent and in any number of its children (tabs stay unique per space_id and ref).
--
-- Owners only, for now: only an owner sees a child (miso.sees_space below, so row level security
-- hides its tabs, layouts and records too), and only an owner makes or deletes one (the two
-- functions; inserts and deletes on miso.spaces stay revoked from members). A child is renamed and
-- restyled like any space (PATCH /api/spaces/:id).
alter table miso.spaces add column parent_id text references miso.spaces (id) on update cascade on delete cascade;
create index spaces_parent_id_idx on miso.spaces (parent_id);

-- The latest rule (20261110000000_departments), plus: a child space is seen only by owners and the
-- service accounts, whatever its own min_tier or space_access rule says.
CREATE OR REPLACE FUNCTION miso.sees_space(p_space text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT p_space IS NULL
        OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.raw_app_meta_data ->> 'miso_service' = 'true')
        OR app.has_at_least('owner'::app.tier)
        OR (NOT EXISTS (SELECT 1 FROM miso.spaces c WHERE c.id = p_space AND c.parent_id IS NOT NULL)
            AND coalesce(
                (SELECT coalesce(
                            app.current_tier() IS NOT NULL
                            AND (app.current_tier() = ANY (a.tiers)
                                 OR auth.uid() = ANY (a.people)
                                 OR EXISTS (SELECT 1 FROM miso.department_members m
                                             WHERE m.user_id = auth.uid() AND m.department_id = ANY (a.departments))),
                            false)
                   FROM miso.space_access a WHERE a.space_id = p_space),
                (SELECT s.min_tier IS NULL OR app.has_at_least(s.min_tier)
                   FROM miso.spaces s WHERE s.id = p_space),
                true
            ))
$fn$;

-- A new child of a top-level space, last among its siblings, with the parent's theme. Its slug is
-- the parent's slug and the name (`data-hiring`), made unique, and never one of the shell's own
-- pages (app/client/lib/router.ts), which the router matches before spaces.
CREATE FUNCTION miso.create_subspace(p_parent text, p_name text)
RETURNS miso.spaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
declare
  v_parent miso.spaces;
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_space miso.spaces;
begin
  if not app.has_at_least('owner'::app.tier) then
    raise exception 'only an owner makes subspaces' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 80 then
    raise exception 'a subspace needs a name of 1 to 80 characters' using errcode = '22023';
  end if;
  -- Locked, so two subspaces made at once under one parent can't pick the same slug.
  select * into v_parent from miso.spaces where id = p_parent for update;
  if not found or v_parent.parent_id is not null then
    raise exception 'subspaces go under a top-level space' using errcode = 'P0002';
  end if;
  v_base := v_parent.slug || '-' || coalesce(nullif(btrim(left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 40), '-'), ''), 'sub');
  v_slug := v_base;
  while v_slug in ('connectors', 'members', 'space-access', 'usage', 'shared-data')
     or exists (select 1 from miso.spaces s where s.slug = v_slug or v_slug = any (s.previous_slugs)) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  insert into miso.spaces (id, slug, name, folder, parent_id, "position", theme)
  values (
    'sub-' || replace(gen_random_uuid()::text, '-', ''),
    v_slug,
    v_name,
    null,
    v_parent.id,
    coalesce((select max(s."position") + 1 from miso.spaces s where s.parent_id = v_parent.id), 0),
    v_parent.theme
  )
  returning * into v_space;
  return v_space;
end
$fn$;

-- Tabs, the grid and any space access rule go with it (on delete cascade). Shared records it wrote
-- move to the parent: records.space_id would otherwise turn null, and a record with no space is
-- every member's.
CREATE FUNCTION miso.delete_subspace(p_space text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
declare
  v_parent text;
begin
  if not app.has_at_least('owner'::app.tier) then
    raise exception 'only an owner deletes subspaces' using errcode = '42501';
  end if;
  select s.parent_id into v_parent from miso.spaces s where s.id = p_space and s.parent_id is not null for update;
  if not found then
    raise exception 'no such subspace' using errcode = 'P0002';
  end if;
  update miso.records set space_id = v_parent where space_id = p_space;
  delete from miso.spaces where id = p_space;
end
$fn$;

revoke all on function miso.create_subspace(text, text) from public;
grant execute on function miso.create_subspace(text, text) to authenticated;
revoke all on function miso.delete_subspace(text) from public;
grant execute on function miso.delete_subspace(text) to authenticated;
