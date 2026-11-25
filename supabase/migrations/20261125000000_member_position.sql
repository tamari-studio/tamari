-- A person's position (job title), asked in the welcome step and shown in People & access.
--
-- Members may update only tier and status on app.app_user, and only admins have an update policy,
-- so a person sets their own position through miso.set_own_position(), which touches nothing but
-- that column of their own row. Adds a column and a function; nothing is dropped or renamed.

SET LOCAL lock_timeout = '10s';

ALTER TABLE app.app_user ADD COLUMN position text
    CONSTRAINT app_user_position_length CHECK (position IS NULL OR char_length(position) BETWEEN 1 AND 80);

COMMENT ON COLUMN app.app_user.position IS 'Their position (job title), set by themself with miso.set_own_position. Null when unset.';

CREATE FUNCTION miso.set_own_position(p_position text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_position text := nullif(btrim(coalesce(p_position, '')), '');
BEGIN
    IF auth.uid() IS NULL OR app.current_tier() IS NULL THEN
        RAISE EXCEPTION 'Only an active member can do this.' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_position) > 80 OR v_position ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'A position is at most 80 characters, on one line.' USING ERRCODE = '22023';
    END IF;
    UPDATE app.app_user SET position = v_position WHERE user_id = auth.uid();
END;
$fn$;

REVOKE ALL ON FUNCTION miso.set_own_position(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION miso.set_own_position(text) TO authenticated;
