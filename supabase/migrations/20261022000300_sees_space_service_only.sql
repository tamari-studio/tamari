-- miso.sees_space() skipped the check for every row in miso.members, but that table holds the
-- people an admin added (roles member and admin) as well as the service accounts. Those people saw
-- every space, so hidden spaces stayed visible to them in PostgREST and Realtime. Only the service
-- accounts (role 'service': space code and the vault) skip the check.
CREATE OR REPLACE FUNCTION miso.sees_space(p_space text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_space is null
    or miso.is_service()
    or app.has_at_least('owner'::app.tier)
    or coalesce(
      (select coalesce(app.current_tier() = any(a.tiers), false) from miso.space_access a where a.space_id = p_space),
      (select s.min_tier is null or app.has_at_least(s.min_tier) from miso.spaces s where s.id = p_space),
      true
    )
$function$;
