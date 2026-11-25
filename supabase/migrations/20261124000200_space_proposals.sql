-- Proposals (Tamari 5b): a member's change to a Team or Everyone space, or a member's draft that
-- should become a Team or Everyone space, waits for an admin or owner to approve it in the app.
--
--  * miso.space_proposals: one row per proposal. `kind` 'change': the member's draft copy of a live
--    space (`space_id` the live space, `draft_space_id` the copy). 'publish': a member's own draft
--    space (`space_id` and `draft_space_id` both the draft) that becomes `visibility`.
--    `base_commit`: the commit of the spaces' history the copy started from; approving refuses when
--    the live folder changed since. `reviewed_commit`: the commit the draft was at when it was sent;
--    approving copies exactly that, so the admin approves what they saw.
--    `author_line`: the author as the commit names them. The author and admins and owners read it; only the service account (the app server) writes it.
--  * miso.sync_spaces(): a new draft copy from spaces.json ("draftOf") gets its live space as
--    parent_id, so it shows as a subspace of the live space, to its author only (sees_space checks
--    draft visibility before the subspace rule).
--  * miso.publish_space(): the service account makes a draft 'team' or 'everyone'. 'team' writes the
--    space's access rule in the same step (the author's teams, the author, admins): a space with no
--    rule would be seen by everyone.
--
-- Adds a table and a function, and replaces sync_spaces with the same signature. Nothing is dropped
-- or renamed.

create table miso.space_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null constraint space_proposals_kind_check check (kind in ('change', 'publish')),
  space_id text not null references miso.spaces (id) on delete cascade,
  draft_space_id text references miso.spaces (id) on delete set null,
  draft_folder text not null,
  summary text not null constraint space_proposals_summary_length check (char_length(summary) between 1 and 200),
  visibility text constraint space_proposals_visibility_check check (visibility in ('team', 'everyone')),
  author uuid not null references auth.users (id) on delete cascade,
  -- "Name <email>" as git takes it: an approved change is committed with the author's name.
  author_line text not null constraint space_proposals_author_line_length check (char_length(author_line) between 1 and 200),
  status text not null default 'open'
    constraint space_proposals_status_check check (status in ('open', 'approved', 'rejected', 'withdrawn', 'out_of_date')),
  base_commit text,
  reviewed_commit text not null,
  decided_by uuid references auth.users (id) on delete set null,
  reason text constraint space_proposals_reason_length check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint space_proposals_publish_visibility check ((kind = 'publish') = (visibility is not null)),
  constraint space_proposals_change_base check (kind = 'publish' or base_commit is not null)
);

-- One open proposal per draft.
create unique index space_proposals_one_open on miso.space_proposals (draft_folder) where status = 'open';
create index space_proposals_author_idx on miso.space_proposals (author);

comment on table miso.space_proposals is
  'Changes and publications of spaces that members proposed, for an admin or owner to approve. Written by the app server only.';

alter table miso.space_proposals enable row level security;

create policy space_proposals_select on miso.space_proposals as permissive for select to authenticated
  using (miso.is_service() or app.has_at_least('admin'::app.tier) or (author = auth.uid() and miso.is_member()));
create policy space_proposals_insert_service on miso.space_proposals as permissive for insert to authenticated
  with check (miso.is_service());
create policy space_proposals_update_service on miso.space_proposals as permissive for update to authenticated
  using (miso.is_service()) with check (miso.is_service());

-- Local stacks grant new tables to every API role by default; keep only what is used.
revoke all on miso.space_proposals from public, anon, authenticated;
grant select, insert, update on miso.space_proposals to authenticated;
grant delete, insert, references, select, trigger, truncate, update on miso.space_proposals to service_role;

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
      insert into miso.spaces as s (id, slug, name, folder, previous_slugs, "position", theme, icon, min_tier, created_by, visibility, parent_id)
      select w.id, w.slug, w.name, w.folder, coalesce(w.previous_slugs, '{}'), coalesce(w."position", 0),
             coalesce(w.theme, '{}'), w.icon, w.min_tier, w.created_by,
             case when w.draft then 'draft' else 'everyone' end,
             -- Only a draft copy takes a parent, and only one that exists.
             case when w.draft then (select p.id from miso.spaces p where p.id = w.parent_id) end
        from jsonb_to_recordset(p_spaces) as w(
          id text, slug text, name text, folder text, previous_slugs text[], "position" integer,
          theme jsonb, icon text, min_tier app.tier, created_by uuid, draft boolean, parent_id text
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

create function miso.publish_space(p_space text, p_visibility text, p_author uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not miso.is_service() then
    raise exception 'only the miso service account publishes spaces' using errcode = '42501';
  end if;
  if p_visibility not in ('team', 'everyone') then
    raise exception 'a space is published to team or everyone' using errcode = '22023';
  end if;
  update miso.spaces s set visibility = p_visibility
   where s.id = p_space and s.visibility = 'draft' and s.created_by = p_author and s.parent_id is null;
  if not found then
    return false;
  end if;
  if p_visibility = 'team' then
    insert into miso.space_access (space_id, tiers, departments, people, updated_by)
    values (
      p_space,
      array['admin'::app.tier],
      coalesce((select array_agg(m.department_id) from miso.department_members m where m.user_id = p_author), '{}'),
      array[p_author],
      p_author
    )
    on conflict (space_id) do update
       set tiers = excluded.tiers, departments = excluded.departments, people = excluded.people,
           updated_by = excluded.updated_by, updated_at = now();
  end if;
  return true;
end
$fn$;

comment on function miso.publish_space(text, text, uuid) is
  'Makes a member''s draft space team (with an access rule: the author''s teams, the author, admins) or everyone. For the service account (an approved proposal).';

revoke all on function miso.publish_space(text, text, uuid) from public, anon;
grant execute on function miso.publish_space(text, text, uuid) to authenticated;
