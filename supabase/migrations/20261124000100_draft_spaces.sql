-- Draft spaces: a member builds their own space over MCP (app/server/mcp-space-tools.ts) and nobody
-- else uses it until it is published (later: a proposal an admin approves).
--
--  * miso.spaces.created_by: who made the space over MCP. Null for every space before this.
--  * miso.spaces.visibility: 'draft', 'team' or 'everyone'. Every existing space is 'everyone',
--    so nothing changes for them. 'team' is decided by the space's access rule (its departments,
--    shown as Teams in the app), like any space with a rule.
--  * miso.sees_space(): a draft is seen by its creator (while a member) and by admins and owners
--    (they review it) and the service accounts. Everything that asks sees_space follows: the
--    space row, its tabs, layout and records (row level security), its usage, its history.
--  * miso.sync_spaces(): a new space from spaces.json gets the creator and 'draft' when its entry
--    says so ("draft": true, "createdBy"). Rows that exist keep their visibility.
--  * miso.delete_draft_space(): the creator's own draft row goes, for the service account.
--  * Connection tokens that may change spaces: any member may make one now (their changes stay in
--    their own drafts); the API still lets only admins and owners change other spaces.
--
-- Adds two columns and a function, and replaces two functions with the same signatures. Nothing
-- is dropped or renamed.

alter table miso.spaces add column created_by uuid references auth.users (id) on delete set null;
alter table miso.spaces add column visibility text not null default 'everyone';
alter table miso.spaces add constraint spaces_visibility_check check (visibility in ('draft', 'team', 'everyone'));

comment on column miso.spaces.visibility is
  'draft: its creator, admins and owners only. team: its access rule decides (its teams). everyone: as before.';

alter policy ai_tokens_insert_edits_admins on miso.ai_tokens
  with check (not edits_spaces or (select miso.is_member()));

CREATE OR REPLACE FUNCTION miso.sees_space(p_space text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT p_space IS NULL
        OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND u.raw_app_meta_data ->> 'miso_service' = 'true')
        OR CASE
             -- A draft: its creator (a member: is_member() is in every policy), admins and owners.
             WHEN EXISTS (SELECT 1 FROM miso.spaces d WHERE d.id = p_space AND d.visibility = 'draft') THEN
                  app.has_at_least('admin'::app.tier)
                  OR (app.current_tier() IS NOT NULL
                      AND EXISTS (SELECT 1 FROM miso.spaces d WHERE d.id = p_space AND d.created_by = auth.uid()))
             -- Anything else: the rule from 20261116000200_subspaces, unchanged.
             ELSE app.has_at_least('owner'::app.tier)
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
           END
$fn$;

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
      insert into miso.spaces as s (id, slug, name, folder, previous_slugs, "position", theme, icon, min_tier, created_by, visibility)
      select w.id, w.slug, w.name, w.folder, coalesce(w.previous_slugs, '{}'), coalesce(w."position", 0),
             coalesce(w.theme, '{}'), w.icon, w.min_tier, w.created_by,
             case when w.draft then 'draft' else 'everyone' end
        from jsonb_to_recordset(p_spaces) as w(
          id text, slug text, name text, folder text, previous_slugs text[], "position" integer,
          theme jsonb, icon text, min_tier app.tier, created_by uuid, draft boolean
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

create function miso.delete_draft_space(p_space text, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not miso.is_service() then
    raise exception 'only the miso service account deletes draft spaces' using errcode = '42501';
  end if;
  delete from miso.spaces s where s.id = p_space and s.visibility = 'draft' and s.created_by = p_user;
  return found;
end
$fn$;

comment on function miso.delete_draft_space(text, uuid) is
  'Deletes a draft space row, only when it is that member''s own draft. For the service account (the MCP tools).';

revoke all on function miso.delete_draft_space(text, uuid) from public, anon;
grant execute on function miso.delete_draft_space(text, uuid) to authenticated;
