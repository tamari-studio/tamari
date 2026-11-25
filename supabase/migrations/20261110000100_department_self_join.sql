-- A new member picks their own name and department(s), once (the app's welcome step).
--
-- Only admins and owners put people in departments, and nobody could change a display name through
-- the API (the grants on app.app_user cover tier and status only). On first sign-in a person now
-- enters their name and picks their department(s) themselves, and sees the spaces those
-- departments open.
--
-- Joining a department is a privilege someone gives themself, so miso.welcome_self() keeps it to
-- the first-time case:
--
--  * only an active account with a tier (app.current_tier()) may call it;
--  * it joins departments only while the caller is in none. After that, or once an admin has
--    placed them, it changes no membership and returns false: later changes stay with admins;
--  * every id must be a department, at most 20 of them, and none may be one that a rule leaving
--    admins out names (miso.department_opens_hidden_space): an admin can't put anyone in those, so
--    a member can't put themself in either. Such a call changes nothing and raises;
--  * the name is trimmed, 1 to 80 characters, and written to the caller's own row only.
--
-- No table grant or policy changes: the function is the only new way in. Adds one function.
--
-- A database that already has it from technobbq/miso (migration 0184) must not run this file:
-- record it as applied instead. docs/org-repos.md says how.

SET LOCAL lock_timeout = '10s';

CREATE FUNCTION miso.welcome_self(p_name text, p_departments uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid  uuid := auth.uid();
    v_name text := btrim(coalesce(p_name, ''));
    v_ids  uuid[] := ARRAY(SELECT DISTINCT d FROM unnest(coalesce(p_departments, '{}'::uuid[])) AS d WHERE d IS NOT NULL);
BEGIN
    IF v_uid IS NULL OR app.current_tier() IS NULL THEN
        RAISE EXCEPTION 'Only an active member can do this.' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_name) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'A name is 1 to 80 characters.' USING ERRCODE = '22023';
    END IF;
    IF cardinality(v_ids) > 20 THEN
        RAISE EXCEPTION 'Pick at most 20 departments.' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM miso.departments d WHERE d.id = ANY (v_ids)) <> cardinality(v_ids) THEN
        RAISE EXCEPTION 'There is no such department.' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_ids) AS d WHERE miso.department_opens_hidden_space(d)) THEN
        RAISE EXCEPTION 'Only an owner puts people in that department.' USING ERRCODE = '42501';
    END IF;

    -- Also the lock that makes "in no department yet" hold for two calls at once.
    UPDATE app.app_user SET display_name = v_name WHERE user_id = v_uid;

    IF cardinality(v_ids) = 0
       OR EXISTS (SELECT 1 FROM miso.department_members m WHERE m.user_id = v_uid) THEN
        RETURN false;
    END IF;
    INSERT INTO miso.department_members (department_id, user_id)
    SELECT d, v_uid FROM unnest(v_ids) AS d;
    RETURN true;
END;
$fn$;

COMMENT ON FUNCTION miso.welcome_self(text, uuid[]) IS
    'The welcome step: sets the caller''s own display name and, only while they are in no '
    'department, puts them in the departments they picked. Returns whether it joined them. '
    'Refuses departments named on a rule that leaves admins out.';

REVOKE ALL ON FUNCTION miso.welcome_self(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION miso.welcome_self(text, uuid[]) TO authenticated;
