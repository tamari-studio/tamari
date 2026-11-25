-- The welcome step's self-join happens at first sign-in only.
--
-- miso.welcome_self() (20261110000100_department_self_join) joined departments whenever the caller
-- was in none. Nothing tied that to first sign-in: every member in no department when that
-- migration ran, and anyone an admin later took out of all their departments, could put themself in
-- a department and see the spaces it opens.
--
-- Now an account is "welcomed" once, for good, and only an admin places a welcomed account:
--
--  * app.app_user.welcomed_at: when the account finished the welcome step or first joined a
--    department, whichever came first. Members have no grant on it; this file refuses to finish if
--    they do.
--  * welcome_self() sets it on every call that completes, departments picked or not (a name-only
--    welcome uses up the self-join too), in the same statement that saves the name. It joins only
--    when it was empty before that call (and, as before, the caller is in no department). A call
--    that fails rolls back and leaves the person free to try again.
--  * a trigger on miso.department_members sets it on the first insert for that person, so an
--    admin's placement uses up the self-join as well.
--  * every account that exists when this runs counts as welcomed, except those still waiting for
--    approval (status 'pending'): they have had no first sign-in yet. An active or suspended account
--    in no department today can't be told apart from one an admin emptied; an admin places them.
--
-- Adds a column, a function and a trigger, and replaces welcome_self()'s body (same signature,
-- grants and errors). Nothing is dropped or renamed.

SET LOCAL lock_timeout = '10s';

ALTER TABLE app.app_user ADD COLUMN welcomed_at timestamptz;

COMMENT ON COLUMN app.app_user.welcomed_at IS
    'When this account first joined a department. Once set, only admins change its departments '
    '(miso.welcome_self joins only while it is empty).';

UPDATE app.app_user SET welcomed_at = now() WHERE welcomed_at IS NULL AND status <> 'pending';

CREATE FUNCTION miso.department_members_mark_welcomed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE app.app_user SET welcomed_at = now() WHERE user_id = NEW.user_id AND welcomed_at IS NULL;
    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION miso.department_members_mark_welcomed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER department_members_mark_welcomed AFTER INSERT ON miso.department_members
    FOR EACH ROW EXECUTE FUNCTION miso.department_members_mark_welcomed();

CREATE OR REPLACE FUNCTION miso.welcome_self(p_name text, p_departments uuid[])
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_uid      uuid := auth.uid();
    v_name     text := btrim(coalesce(p_name, ''));
    v_ids      uuid[] := ARRAY(SELECT DISTINCT d FROM unnest(coalesce(p_departments, '{}'::uuid[])) AS d WHERE d IS NOT NULL);
    v_welcomed timestamptz;
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

    -- The value before this call decides the join; the row lock makes it hold for two calls at once.
    SELECT u.welcomed_at INTO v_welcomed FROM app.app_user u WHERE u.user_id = v_uid FOR UPDATE;
    UPDATE app.app_user SET display_name = v_name, welcomed_at = coalesce(welcomed_at, now()) WHERE user_id = v_uid;

    IF cardinality(v_ids) = 0
       OR v_welcomed IS NOT NULL
       OR EXISTS (SELECT 1 FROM miso.department_members m WHERE m.user_id = v_uid) THEN
        RETURN false;
    END IF;
    INSERT INTO miso.department_members (department_id, user_id)
    SELECT d, v_uid FROM unnest(v_ids) AS d;
    RETURN true;
END;
$fn$;

COMMENT ON FUNCTION miso.welcome_self(text, uuid[]) IS
    'The welcome step: sets the caller''s own display name, marks the account welcomed and, only if '
    'it was not welcomed before this call (app.app_user.welcomed_at) and is in no department, puts '
    'them in the departments they picked. Returns whether it joined them. Refuses departments named '
    'on a rule that leaves admins out.';

-- Members (and anyone signed out) must not be able to mark or unmark themselves.
DO $check$
BEGIN
    IF has_column_privilege('authenticated', 'app.app_user', 'welcomed_at', 'UPDATE')
       OR has_column_privilege('authenticated', 'app.app_user', 'welcomed_at', 'INSERT')
       OR has_column_privilege('anon', 'app.app_user', 'welcomed_at', 'UPDATE')
       OR has_column_privilege('anon', 'app.app_user', 'welcomed_at', 'INSERT') THEN
        RAISE EXCEPTION 'app.app_user.welcomed_at is writable by members; revoke the table-level grant first';
    END IF;
END;
$check$;
