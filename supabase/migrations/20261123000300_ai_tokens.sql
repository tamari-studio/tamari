-- Connection tokens for "Connect your AI" (Settings → Personal, POST /api/mcp).
--
-- A member makes a named token and pastes it into their own AI tool (Claude Code and other tools
-- that speak the Model Context Protocol). The tool then reads the workspace as that member:
-- app/server/mcp.ts turns the token into the member it belongs to, opens that member's own session
-- and runs the same member checks as every other /api route. So a token never carries more than
-- its member has, and it stops working when the member is suspended or removed.
--
--  * miso.ai_tokens holds one row per token and only the token's SHA-256, never the token. A row
--    goes with its member (on delete cascade), so a deleted account leaves no token behind.
--  * Row level security: a member reads, makes and deletes their own rows only. They can't read
--    token_hash or write user_id or last_used_at (column grants).
--  * miso.ai_token_owner(hash) answers "whose token is this" for the API, which asks before it
--    knows who is calling. Only the vault account (miso.is_service) may call it, like
--    miso.connector_secrets(). It also keeps last_used_at, at most once a minute per token.
--
-- Adds a table, an index, three policies and a function. Nothing is dropped or renamed.

create table miso.ai_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  token_hash text not null,
  created_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone,
  constraint ai_tokens_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint ai_tokens_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_tokens_hash_key unique (token_hash)
);

comment on table miso.ai_tokens is
  'Connection tokens a member made for their own AI tool (Settings, Connect your AI). Holds the '
  'SHA-256 of each token, never the token.';

create index ai_tokens_user_created on miso.ai_tokens using btree (user_id, created_at desc);

alter table miso.ai_tokens enable row level security;

create policy ai_tokens_select_own on miso.ai_tokens as permissive for select to authenticated
  using ((select miso.is_member()) and user_id = (select auth.uid()));
create policy ai_tokens_insert_own on miso.ai_tokens as permissive for insert to authenticated
  with check ((select miso.is_member()) and user_id = (select auth.uid()));
create policy ai_tokens_delete_own on miso.ai_tokens as permissive for delete to authenticated
  using ((select miso.is_member()) and user_id = (select auth.uid()));

-- Local stacks grant new tables to every API role by default; keep only what the page needs.
revoke all on miso.ai_tokens from public, anon, authenticated;
grant select (id, user_id, name, created_at, last_used_at) on miso.ai_tokens to authenticated;
grant insert (name, token_hash) on miso.ai_tokens to authenticated;
grant delete on miso.ai_tokens to authenticated;
grant delete, insert, references, select, trigger, truncate, update on miso.ai_tokens to service_role;

create function miso.ai_token_owner(p_hash text)
returns table (user_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not miso.is_service() then
    raise exception 'only the miso service account can look up connection tokens' using errcode = '42501';
  end if;
  update miso.ai_tokens t set last_used_at = now()
    where t.token_hash = p_hash and (t.last_used_at is null or t.last_used_at < now() - interval '1 minute');
  -- The join keeps a token from ever naming an account that is gone.
  return query
    select t.user_id, u.email::text
    from miso.ai_tokens t
    join auth.users u on u.id = t.user_id
    where t.token_hash = p_hash;
end
$fn$;

comment on function miso.ai_token_owner(text) is
  'Whose connection token has this SHA-256: the member''s id and email, or no row. For the vault '
  'account only (the API asks before it knows the caller). Keeps last_used_at.';

revoke all on function miso.ai_token_owner(text) from public, anon;
grant execute on function miso.ai_token_owner(text) to authenticated;

-- Members (and anyone signed out) must never read a hash or re-point a token.
do $check$
begin
  if has_column_privilege('authenticated', 'miso.ai_tokens', 'token_hash', 'SELECT')
     or has_column_privilege('authenticated', 'miso.ai_tokens', 'user_id', 'INSERT')
     or has_table_privilege('authenticated', 'miso.ai_tokens', 'UPDATE')
     or has_table_privilege('anon', 'miso.ai_tokens', 'SELECT') then
    raise exception 'miso.ai_tokens is readable or writable beyond its column grants; revoke the wider grant first';
  end if;
end;
$check$;
