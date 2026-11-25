-- Runs once, when the database volume is new (docker-compose.yml mounts it into the image's init
-- folder). Gives the roles the services log in as the password from .env, and makes the schema
-- Realtime keeps its own tables in. Taken from supabase/docker (volumes/db/roles.sql, jwt.sql,
-- realtime.sql) and the Supabase CLI's local init.
\set pgpass `echo "$POSTGRES_PASSWORD"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER USER postgres WITH PASSWORD :'pgpass';
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';

ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';

create schema if not exists _realtime;
alter schema _realtime owner to supabase_admin;
