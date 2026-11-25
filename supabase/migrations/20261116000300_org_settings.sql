-- Organisation settings: one look (font, color, corners) for the whole app instead of one per
-- space. A single row every member reads and only admins and owners change (Settings page,
-- PUT /api/settings/theme). miso.spaces.theme stays, unused by the app from here on.
create table miso.org_settings (
  id boolean primary key default true constraint org_settings_one_row check (id),
  theme jsonb not null default '{}'::jsonb constraint org_settings_theme_object check (jsonb_typeof(theme) = 'object')
);

alter table miso.org_settings enable row level security;
create policy org_settings_select_member on miso.org_settings as permissive for select to authenticated
  using (miso.is_member());
create policy org_settings_update_admin on miso.org_settings as permissive for update to authenticated
  using (miso.is_member() and app.has_at_least('admin'::app.tier))
  with check (miso.is_member() and app.has_at_least('admin'::app.tier));
grant select, update (theme) on miso.org_settings to authenticated;

-- The one row, starting from the look most spaces.json spaces have today (ties: the first in the
-- sidebar), so the change from per-space themes keeps the common look.
insert into miso.org_settings (theme)
select coalesce(
  (select s.theme from miso.spaces s where s.folder is not null group by s.theme order by count(*) desc, min(s."position") limit 1),
  '{}'::jsonb
);

alter publication supabase_realtime add table miso.org_settings;
