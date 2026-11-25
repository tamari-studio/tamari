-- Invite people: an admin or owner invites an email address at a role, and when that person signs
-- up (email code, link or Google) they land active at that role instead of waiting. Any email
-- domain can be invited; allowed domains keep letting their people in without one.
--
--  * miso.invitations: one row per invite. Open = not accepted, not revoked, not expired. Expires
--    14 days after it was made. At most one open invite per address (a lower-cased email); inviting
--    an address again revokes the old one first (the server does that).
--  * Admins and owners (app tier, as 20261122000000_allowed_domains_admins) read, make and revoke
--    invites. Revoking is the only update: authenticated may update revoked_at and nothing else, and
--    only the sign-up trigger marks one accepted. An invite at owner needs an owner. No delete.
--  * app.app_user_bootstrap(): after the first-user branch, an open invite for the new address
--    makes them active at its role (a tier_change row credits the inviter) and marks it accepted.
--    Otherwise unchanged: allowed domain -> member, anyone else waits.
--
-- Only adds: one table, its policies and grants; the bootstrap function's body is replaced with the
-- same branches plus the invite one.

SET LOCAL lock_timeout = '10s';

create table miso.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null
                constraint invitations_email_format check (email = lower(btrim(email)) and email like '_%@_%' and char_length(email) <= 320),
  tier        app.tier not null,
  invited_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  revoked_at  timestamptz
);

-- One open invite per address. Expiry can't be in the predicate (now() isn't immutable), so an
-- expired one is revoked before the address is invited again.
create unique index invitations_open_email on miso.invitations (email)
  where accepted_at is null and revoked_at is null;

alter table miso.invitations enable row level security;

create policy invitations_select_admin on miso.invitations as permissive for select to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier));
create policy invitations_insert_admin on miso.invitations as permissive for insert to authenticated
  with check (
    miso.is_member() and app.has_at_least('admin'::app.tier)
    and invited_by = (select auth.uid())
    and accepted_at is null and revoked_at is null
    and (tier <> 'owner'::app.tier or app.has_at_least('owner'::app.tier))
  );
create policy invitations_update_admin on miso.invitations as permissive for update to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier))
  with check (miso.is_member() and app.has_at_least('admin'::app.tier));

grant select, insert on miso.invitations to authenticated;
grant update (revoked_at) on miso.invitations to authenticated;

CREATE OR REPLACE FUNCTION app.app_user_bootstrap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    is_first_user  boolean;
    allowed_domain boolean;
    invite         miso.invitations;
    name          text := coalesce(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name');
BEGIN
    -- The app's own service accounts (scripts/supabase-setup.ts) are not people. Auth writes
    -- app_metadata after this insert, so the flag is read from user_metadata. Anyone could set it
    -- on their own sign-up, but it only takes away: no tier, never the owner.
    IF coalesce(NEW.raw_user_meta_data ->> 'miso_service', '') = 'true' THEN
        RETURN NEW;
    END IF;

    LOCK TABLE app.app_user IN SHARE ROW EXCLUSIVE MODE;

    is_first_user := NOT EXISTS (SELECT 1 FROM app.app_user);
    allowed_domain := EXISTS (
        SELECT 1 FROM miso.allowed_domains d
         WHERE d.domain = lower(split_part(NEW.email, '@', 2))
    );
    SELECT * INTO invite FROM miso.invitations i
     WHERE i.email = lower(btrim(NEW.email))
       AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
     FOR UPDATE;

    IF is_first_user THEN
        INSERT INTO app.app_user (user_id, email, display_name, tier, status)
        VALUES (NEW.id, NEW.email, name, 'owner'::app.tier, 'active');

        INSERT INTO app.tier_change (user_id, from_tier, to_tier, changed_by, reason)
        VALUES (NEW.id, NULL, 'owner'::app.tier, NEW.id, 'first user bootstrap');
    ELSIF invite.id IS NOT NULL THEN
        INSERT INTO app.app_user (user_id, email, display_name, tier, status)
        VALUES (NEW.id, NEW.email, name, invite.tier, 'active');

        INSERT INTO app.tier_change (user_id, from_tier, to_tier, changed_by, reason)
        VALUES (NEW.id, NULL, invite.tier, coalesce(invite.invited_by, NEW.id), 'invited');

        UPDATE miso.invitations SET accepted_at = now() WHERE id = invite.id;
    ELSIF allowed_domain THEN
        INSERT INTO app.app_user (user_id, email, display_name, tier, status)
        VALUES (NEW.id, NEW.email, name, 'member'::app.tier, 'active');

        INSERT INTO app.tier_change (user_id, from_tier, to_tier, changed_by, reason)
        VALUES (NEW.id, NULL, 'member'::app.tier, NEW.id, 'member by default at sign-up');
    ELSE
        INSERT INTO app.app_user (user_id, email, display_name, tier, status)
        VALUES (NEW.id, NEW.email, name, NULL, 'pending');
    END IF;

    RETURN NEW;
END;
$function$;
