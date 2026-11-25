-- Departments, and space access by department and by person, not only by tier.
--
-- A Space access rule (miso.space_access) named tiers only. Now a rule also names departments and
-- single people, and anyone matching any of the three sees the space. Tiers stay, so the rules
-- already set keep working unchanged.
--
--  * miso.departments: the departments, named by admins and owners on the People & access page.
--  * miso.department_members: who is in which; one person can be in several.
--  * miso.space_access.departments and .people: who else sees the space besides its tiers.
--  * miso.sees_space(): a rule lets in its tiers, its people and its departments' members. Only an
--    active account with a tier counts, as for tiers: naming a suspended person or a department
--    they're in doesn't let them back in. Owners and the service accounts still see every space.
--  * miso.space_access_rules(): returns the departments and people too, and `members`: everyone a
--    rule names, directly or through a department. The API caches the rules for every caller, so it
--    checks someone by id against `members` instead of looking up their departments.
--
-- Everyone who can use the app reads departments and who is in them (the rules are not secret
-- either); only admins and owners change them. Deleting a department takes it out of every rule
-- that named it.
--
-- An admin can't use a department to reach a space admins don't see (hidden_spaces: only an owner
-- changes such a rule). A department named on a rule that leaves admins out is changed only by an
-- owner: its members, and deleting it. Renaming stays open to admins, because a name opens nothing.
--
-- Adds only, with one replacement: miso.space_access_rules() changes its return type, so it is
-- dropped and created again in this file. The new result has the old columns first (space_id,
-- tiers) and more after them, so a shell that reads only those two keeps working.
--
-- A database that already has these objects from technobbq/miso (migrations 0172 and 0173) must
-- not run this file: record it as applied instead. docs/org-repos.md says how.

SET LOCAL lock_timeout = '10s';

CREATE TABLE miso.departments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL
                   CONSTRAINT departments_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX departments_name_key ON miso.departments (lower(btrim(name)));

COMMENT ON TABLE miso.departments IS
    'Departments people belong to. A Space access rule can name them. Admins and owners add, '
    'rename and delete them on the People & access page.';

CREATE TABLE miso.department_members (
    department_id uuid NOT NULL
                      CONSTRAINT department_members_department_id_fkey
                      REFERENCES miso.departments (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL
                      CONSTRAINT department_members_user_id_fkey
                      REFERENCES auth.users (id) ON DELETE CASCADE,
    PRIMARY KEY (department_id, user_id)
);

CREATE INDEX department_members_user_id_idx ON miso.department_members (user_id);

COMMENT ON TABLE miso.department_members IS
    'Who is in which department; one person can be in several.';

ALTER TABLE miso.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE miso.department_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE miso.space_access
    ADD COLUMN departments uuid[] NOT NULL DEFAULT '{}'
        CONSTRAINT space_access_departments_no_nulls CHECK (array_position(departments, NULL) IS NULL),
    ADD COLUMN people uuid[] NOT NULL DEFAULT '{}'
        CONSTRAINT space_access_people_no_nulls CHECK (array_position(people, NULL) IS NULL);

COMMENT ON COLUMN miso.space_access.departments IS
    'Departments (miso.departments) whose members see this space, besides its tiers.';
COMMENT ON COLUMN miso.space_access.people IS
    'People (auth.users ids) who see this space, besides its tiers and departments.';

-- Whether a rule that leaves admins out names this department.
CREATE FUNCTION miso.department_opens_hidden_space(p_department uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM miso.space_access a
         WHERE p_department = ANY (a.departments)
           AND NOT ('admin'::app.tier = ANY (a.tiers))
    )
$fn$;

COMMENT ON FUNCTION miso.department_opens_hidden_space(uuid) IS
    'Whether a Space access rule that leaves admins out names this department: then only an '
    'owner changes who is in it or deletes it.';

REVOKE ALL ON FUNCTION miso.department_opens_hidden_space(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION miso.department_opens_hidden_space(uuid) TO authenticated;

CREATE POLICY departments_select ON miso.departments FOR SELECT TO authenticated
    USING ((SELECT miso.is_member()));
CREATE POLICY departments_insert_admin ON miso.departments FOR INSERT TO authenticated
    WITH CHECK ((SELECT app.has_at_least('admin'::app.tier)));
CREATE POLICY departments_update_admin ON miso.departments FOR UPDATE TO authenticated
    USING ((SELECT app.has_at_least('admin'::app.tier)))
    WITH CHECK ((SELECT app.has_at_least('admin'::app.tier)));
CREATE POLICY departments_delete_admin ON miso.departments FOR DELETE TO authenticated
    USING ((SELECT app.has_at_least('owner'::app.tier))
        OR ((SELECT app.has_at_least('admin'::app.tier)) AND NOT miso.department_opens_hidden_space(id)));

CREATE POLICY department_members_select ON miso.department_members FOR SELECT TO authenticated
    USING ((SELECT miso.is_member()));
CREATE POLICY department_members_insert_admin ON miso.department_members FOR INSERT TO authenticated
    WITH CHECK ((SELECT app.has_at_least('owner'::app.tier))
        OR ((SELECT app.has_at_least('admin'::app.tier)) AND NOT miso.department_opens_hidden_space(department_id)));
CREATE POLICY department_members_delete_admin ON miso.department_members FOR DELETE TO authenticated
    USING ((SELECT app.has_at_least('owner'::app.tier))
        OR ((SELECT app.has_at_least('admin'::app.tier)) AND NOT miso.department_opens_hidden_space(department_id)));

-- Say what authenticated may do, whatever the schema's default privileges hand out.
REVOKE ALL ON miso.departments, miso.department_members FROM PUBLIC, authenticated;
GRANT SELECT, DELETE ON miso.departments TO authenticated;
GRANT INSERT (name), UPDATE (name) ON miso.departments TO authenticated;
GRANT SELECT, INSERT, DELETE ON miso.department_members TO authenticated;

-- A deleted department leaves no id behind in the rules that named it.
CREATE FUNCTION miso.departments_forget()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE miso.space_access
       SET departments = array_remove(departments, OLD.id)
     WHERE OLD.id = ANY (departments);
    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION miso.departments_forget() FROM PUBLIC, authenticated;

CREATE TRIGGER departments_forget
    AFTER DELETE ON miso.departments
    FOR EACH ROW
    EXECUTE FUNCTION miso.departments_forget();

-- The latest rule (20261022000400, which also lets the service accounts through) plus the rule's
-- people and departments.
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
        OR coalesce(
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
        )
$fn$;

-- The return type changes, so the function is replaced, not altered.
DROP FUNCTION miso.space_access_rules();

CREATE FUNCTION miso.space_access_rules()
RETURNS TABLE (space_id text, tiers app.tier[], departments uuid[], people uuid[], members uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT miso.is_member() THEN
        RAISE EXCEPTION 'Only people who can use the app read space access rules.' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
        SELECT a.space_id, a.tiers, a.departments, a.people,
               ARRAY(
                   SELECT p FROM unnest(a.people) AS p
                   UNION
                   SELECT m.user_id FROM miso.department_members m WHERE m.department_id = ANY (a.departments)
                   ORDER BY 1
               )
          FROM miso.space_access a
         ORDER BY a.space_id;
END;
$$;

COMMENT ON FUNCTION miso.space_access_rules() IS
    'Every row of miso.space_access for anyone miso.is_member() lets in, with `members`: everyone '
    'the rule names, directly or through a department. Raises 42501 for anyone else, so a cached '
    'read can never be an empty answer to someone who lost access.';

REVOKE ALL ON FUNCTION miso.space_access_rules() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION miso.space_access_rules() TO authenticated;
