-- At least one active owner, also when two owners demote or suspend each other at the same moment.
--
-- app.app_user_guard_last_owner() refused a change that removed the last active owner, but on the
-- UPDATE path it took no lock: two transactions each saw the other owner still active, both
-- committed, and the workspace had no owner (recovery needed SQL). app.member_erase() already
-- serialises deletions with an advisory lock; the guard now takes the same lock before it looks,
-- whenever the row it changes is an active owner losing that. The second change then waits for the
-- first to commit, and its check (a new statement, so a new snapshot under READ COMMITTED, which
-- PostgREST uses) sees the first one's result and is refused.
--
-- Only the function body changes: same name, signature, SECURITY DEFINER, search_path, message
-- and error code, and the trigger that calls it stays as it is. Nothing is dropped.
--
-- An erase and a demotion of the same owner at the same moment take the row lock and the advisory
-- lock in opposite order. Postgres then aborts one of them as a deadlock, which changes nothing;
-- the person tries again.

SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION app.app_user_guard_last_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    removes_ownership boolean;
    verb              text;
BEGIN
    -- NEW is unassigned in a DELETE trigger and SQL's OR does not short
    -- circuit, so the two cases are branched rather than combined.
    IF TG_OP = 'DELETE' THEN
        removes_ownership := true;
        verb := 'deletion';
    ELSE
        removes_ownership := NEW.tier IS DISTINCT FROM 'owner'::app.tier
                          OR NEW.status IS DISTINCT FROM 'active';
        verb := 'demotion or suspension';
    END IF;

    IF OLD.tier = 'owner'::app.tier AND OLD.status = 'active' AND removes_ownership THEN
        -- The lock app.member_erase() takes: one owner removal at a time, until commit.
        PERFORM pg_advisory_xact_lock(hashtext('app.member_erase'));

        IF NOT EXISTS (
            SELECT 1
              FROM app.app_user o
             WHERE o.user_id <> OLD.user_id
               AND o.tier = 'owner'::app.tier
               AND o.status = 'active'
        ) THEN
            RAISE EXCEPTION
                'last-owner invariant: % of the only active owner is refused -- at least one active owner must exist at all times',
                verb
                USING HINT = 'Grant owner to another active user first, then change this row.';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;
