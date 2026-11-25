-- Connection tokens that may change spaces (the Compose install's MCP write tools, app/server/mcp-space-tools.ts).
--
-- A token made before this, or made without the switch, stays read-only: the column defaults to
-- false. A token with it on still needs a member who is an admin or owner at the time of each call;
-- the API checks that on every write.
--
--  * miso.ai_tokens.edits_spaces: set once, when the token is made. A member may set it only when
--    they are an admin or owner (a restrictive insert policy); nobody can change it later (no update grant).
--  * miso.ai_token_edits_spaces(hash): whether a token has it, for the vault account only, like
--    miso.ai_token_owner().
--
-- Adds a column, a policy and a function. Nothing is dropped or renamed.

alter table miso.ai_tokens add column edits_spaces boolean not null default false;

comment on column miso.ai_tokens.edits_spaces is
  'The token may change spaces over MCP (Settings, "May change spaces"). Only an admin or owner can make one.';

grant select (edits_spaces) on miso.ai_tokens to authenticated;
grant insert (edits_spaces) on miso.ai_tokens to authenticated;

create policy ai_tokens_insert_edits_admins on miso.ai_tokens as restrictive for insert to authenticated
  with check (not edits_spaces or (select app.has_at_least('admin'::app.tier)));

create function miso.ai_token_edits_spaces(p_hash text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not miso.is_service() then
    raise exception 'only the miso service account can look up connection tokens' using errcode = '42501';
  end if;
  return coalesce((select t.edits_spaces from miso.ai_tokens t where t.token_hash = p_hash), false);
end
$fn$;

comment on function miso.ai_token_edits_spaces(text) is
  'Whether the connection token with this SHA-256 may change spaces. For the vault account only.';

revoke all on function miso.ai_token_edits_spaces(text) from public, anon;
grant execute on function miso.ai_token_edits_spaces(text) to authenticated;
