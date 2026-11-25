-- 20261022000300 let only role 'service' skip miso.sees_space(), but space code runs as the
-- spaces account, which is role 'member' and has no tier: it lost every record of a space with a
-- minTier or a rule, and its writes there failed. The service accounts are the users whose
-- app_metadata says miso_service (scripts/supabase-setup.ts sets it through the Auth admin API;
-- nobody can set their own app_metadata). People an admin adds to miso.members, and anyone who
-- puts miso_service in their own user_metadata, still get the tier check.
CREATE OR REPLACE FUNCTION miso.sees_space(p_space text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_space is null
    or exists (select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data ->> 'miso_service' = 'true')
    or app.has_at_least('owner'::app.tier)
    or coalesce(
      (select coalesce(app.current_tier() = any(a.tiers), false) from miso.space_access a where a.space_id = p_space),
      (select s.min_tier is null or app.has_at_least(s.min_tier) from miso.spaces s where s.id = p_space),
      true
    )
$function$;

-- Only miso.sync_spaces() (the vault account, security definer) adds spaces. sees_space() is true
-- for an id that doesn't exist yet, so a member could insert any space they liked.
revoke insert on miso.spaces from authenticated;
