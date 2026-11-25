-- Only admins and owners rename a space, in the database too. Until now every member could update
-- miso.spaces.name and .theme directly through the API (20261021000000_audit_fixes' column grant);
-- the app already only lets admins rename (Settings → Organisation, PATCH /api/spaces/:id), and the
-- app's look moved to miso.org_settings, so neither column needs a member grant any more.
--
-- Renames now go through miso.rename_space(), which checks the caller. A shell older than this one
-- renames with a direct update, which this refuses: its Space settings dialog stops saving names.

create function miso.rename_space(p_space text, p_name text)
returns miso.spaces
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_space miso.spaces;
begin
  if not (miso.is_member() and app.has_at_least('admin'::app.tier) and miso.sees_space(p_space)) then
    raise exception 'only admins and owners rename a space they see' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'a space needs a name of 1 to 80 characters, on one line' using errcode = '22023';
  end if;
  update miso.spaces set name = v_name where id = p_space returning * into v_space;
  if not found then
    raise exception 'no such space' using errcode = 'P0002';
  end if;
  return v_space;
end
$fn$;

revoke all on function miso.rename_space(text, text) from public;
grant execute on function miso.rename_space(text, text) to authenticated;

revoke update (name, theme) on miso.spaces from authenticated;
