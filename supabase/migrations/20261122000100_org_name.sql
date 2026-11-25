-- The workspace name a team sets (Settings → Organisation, PUT /api/settings/name): shown at the top
-- of the sidebar instead of the product name. Null means unset. Only adds a column and a grant; the
-- existing policies already let every member read the row and only admins and owners update it.
alter table miso.org_settings add column name text
  constraint org_settings_name_length check (name is null or char_length(btrim(name)) between 1 and 60);

grant update (name) on miso.org_settings to authenticated;
