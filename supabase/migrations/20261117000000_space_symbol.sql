-- A space's symbol: the icon an admin picks for it on Settings → Organisation, shown in the sidebar.
-- Not miso.spaces.icon: that column is the catalog's (.workspace.json, written by sync_spaces on
-- every sync), so a pick stored there would be reset. Null shows the shell's default icon.
--
-- miso.edit_space() saves a name, a symbol or both in one update, with the same guard as
-- rename_space() (kept for older shells). The shell checks the symbol against its icon list; the
-- database only checks its shape, so a new icon needs no migration. Members have no update grant on
-- the new column.
alter table miso.spaces add column symbol text
  constraint spaces_symbol_shape check (symbol ~ '^[a-z0-9-]{1,32}$');

-- p_name null keeps the name; p_symbol null keeps the symbol, '' clears it.
create function miso.edit_space(p_space text, p_name text, p_symbol text)
returns miso.spaces
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name text := btrim(p_name);
  v_space miso.spaces;
begin
  if not (miso.is_member() and app.has_at_least('admin'::app.tier) and miso.sees_space(p_space)) then
    raise exception 'only admins and owners edit a space they see' using errcode = '42501';
  end if;
  if p_name is not null and (v_name = '' or char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]') then
    raise exception 'a space needs a name of 1 to 80 characters, on one line' using errcode = '22023';
  end if;
  if p_symbol is not null and p_symbol <> '' and p_symbol !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'not a symbol id' using errcode = '22023';
  end if;
  update miso.spaces
     set name = coalesce(v_name, name),
         symbol = case when p_symbol is null then symbol else nullif(p_symbol, '') end
   where id = p_space
   returning * into v_space;
  if not found then
    raise exception 'no such space' using errcode = 'P0002';
  end if;
  return v_space;
end
$fn$;

revoke all on function miso.edit_space(text, text, text) from public;
grant execute on function miso.edit_space(text, text, text) to authenticated;
