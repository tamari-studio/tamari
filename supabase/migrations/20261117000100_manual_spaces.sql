-- Manual spaces: a top-level space an admin adds on Settings → Organisation, with no folder in
-- spaces.json. Like a subspace it is only a row (folder null), so tabs, layouts, records, subspaces
-- and space access rules work on it unchanged; its tabs hold views from any folder.
--
-- Its id is `space-` and 32 hex digits, which is how the shell tells it from a spaces.json space
-- that was dropped or freed (app/lib/access.ts isManualSpace; those it hides). sync_spaces needs
-- no change: it never deletes a row. The one thing it does to a manual space is free its slug when
-- a later spaces.json entry takes that slug (the manual space then answers at `freed-…`).
--
-- Seen like any top-level space: by everyone until an admin sets a rule on the Space access page
-- (min_tier stays null). Members still can't insert into miso.spaces; this function is the way in.
create function miso.create_space(p_name text, p_symbol text)
returns miso.spaces
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_base text;
  v_slug text;
  v_n integer := 1;
  v_space miso.spaces;
begin
  if not (miso.is_member() and app.has_at_least('admin'::app.tier)) then
    raise exception 'only admins and owners add a space' using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]' then
    raise exception 'a space needs a name of 1 to 80 characters, on one line' using errcode = '22023';
  end if;
  if p_symbol is not null and p_symbol <> '' and p_symbol !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'not a symbol id' using errcode = '22023';
  end if;
  -- No parent row to lock: two spaces added at once wait here, so they can't pick the same slug.
  perform pg_advisory_xact_lock(hashtext('miso.create_space'));
  v_base := coalesce(nullif(btrim(left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 40), '-'), ''), 'space');
  v_slug := v_base;
  -- The shell's own first path segments (app/client/lib/router.ts, the server's /api and the
  -- build's /assets), which are matched before spaces.
  while v_slug in ('connectors', 'members', 'space-access', 'usage', 'settings', 'shared-data', 'api', 'assets')
     or exists (select 1 from miso.spaces s where s.slug = v_slug or v_slug = any (s.previous_slugs)) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  insert into miso.spaces (id, slug, name, folder, parent_id, "position", theme, symbol)
  values (
    'space-' || replace(gen_random_uuid()::text, '-', ''),
    v_slug,
    v_name,
    null,
    null,
    coalesce((select max(s."position") + 1 from miso.spaces s where s.parent_id is null), 0),
    '{}',
    nullif(p_symbol, '')
  )
  returning * into v_space;
  return v_space;
end
$fn$;

revoke all on function miso.create_space(text, text) from public;
grant execute on function miso.create_space(text, text) to authenticated;
