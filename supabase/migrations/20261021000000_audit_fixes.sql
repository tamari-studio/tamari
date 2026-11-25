-- Fixes from the 21 Oct 2026 audit.

-- A suspended person stays out. The allowed-domain branch let anyone on a listed domain in,
-- whatever their app_user.status. Sign-up already makes domain users active, so the branch only
-- ever undid a suspension (or let in a domain sign-up that set miso_service and got no row).
CREATE OR REPLACE FUNCTION miso.is_member()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and (
        exists (select 1 from miso.members m where m.user_id = u.id)
        or exists (select 1 from app.app_user a where a.user_id = u.id and a.status = 'active')
      )
  )
$function$;

-- Spaces come from spaces.json: the app only adds missing ones and renames, themes or reorders
-- them. Deleting a space or changing its id cascaded away its access rule, tabs and layout, and the
-- next workspace load added it back with no rule, so any member could open an admin-only space.
revoke delete, update on miso.spaces from authenticated;
grant update (name, theme, position) on miso.spaces to authenticated;

-- The Shared data page's counts. A plain select stops at PostgREST's max_rows (1000).
CREATE OR REPLACE FUNCTION miso.record_collections()
 RETURNS TABLE(name text, count bigint, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select collection, count(*), max(updated_at) from miso.records group by collection order by collection
$function$;

revoke all on function miso.record_collections() from public;
grant execute on function miso.record_collections() to authenticated;
