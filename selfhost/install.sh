#!/usr/bin/env bash
# Installs Tamari with its own Supabase on this machine. Run it in a clone of the repo:
#
#   ./selfhost/install.sh
#
# Safe to run again: it keeps an existing .env, builds and starts what changed, makes sure the owner
# account is there and prints a new sign-in link. README.md in this folder has the rest.
set -euo pipefail
cd "$(dirname "$0")"

fail() {
  echo "tamari: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Install Docker (https://docs.docker.com/get-docker/), then run this again."
docker compose version >/dev/null 2>&1 || fail "Docker Compose is missing ('docker compose' doesn't run). Install Docker Compose v2, then run this again."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker, then run this again."
command -v openssl >/dev/null 2>&1 || fail "openssl is not installed. Install it, then run this again."

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# An API key: a JWT for the role, signed with the JWT secret, valid for 10 years.
jwt() {
  local now head body
  now=$(date +%s)
  head=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  body=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" "$((now + 10 * 365 * 24 * 3600))" | b64url)
  printf '%s.%s.%s' "$head" "$body" "$(printf '%s.%s' "$head" "$body" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
}

if [ -f .env ]; then
  echo "tamari: keeping the existing .env, because the database already uses its keys."
else
  # Init and keys only fit a database made with them: never write new keys over an old database.
  if docker volume inspect "${COMPOSE_PROJECT_NAME:-tamari}_db-data" >/dev/null 2>&1; then
    fail "There is a Tamari database (Docker volume ${COMPOSE_PROJECT_NAME:-tamari}_db-data) but no .env next to this script. New keys wouldn't fit that database. Put the old .env back, or delete the database and all its data with 'docker compose down -v' in $(pwd), then run this again."
  fi
  read -r -p "The address people will open Tamari at [http://localhost:13390]: " app_url
  app_url=${app_url:-http://localhost:13390}
  app_url=${app_url%/}
  [[ "$app_url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || fail "The address must look like http://localhost:13390 or https://tamari.example.com (no path)."
  port=$(printf '%s' "$app_url" | sed -nE 's#^https?://[^:]+:([0-9]+)$#\1#p')
  jwt_secret=$(openssl rand -hex 32)
  umask 077
  sed -e "s#^APP_URL=.*#APP_URL=$app_url#" \
    -e "s#^HTTP_PORT=.*#HTTP_PORT=${port:-13390}#" \
    -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 24)#" \
    -e "s#^JWT_SECRET=.*#JWT_SECRET=$jwt_secret#" \
    -e "s#^ANON_KEY=.*#ANON_KEY=$(jwt anon "$jwt_secret")#" \
    -e "s#^SERVICE_ROLE_KEY=.*#SERVICE_ROLE_KEY=$(jwt service_role "$jwt_secret")#" \
    -e "s#^REALTIME_SECRET_KEY_BASE=.*#REALTIME_SECRET_KEY_BASE=$(openssl rand -hex 32)#" \
    -e "s#^REALTIME_DB_ENC_KEY=.*#REALTIME_DB_ENC_KEY=$(openssl rand -hex 8)#" \
    .env.example >.env
  echo "tamari: wrote .env with new keys for $app_url."
fi

read -r -p "The owner's email address: " email
[ -n "$email" ] || fail "The owner's email address is needed."

echo "tamari: building and starting. The first time takes a few minutes."
docker compose up -d --build --wait --wait-timeout 600 ||
  fail "Tamari didn't become healthy. 'docker compose ps' and 'docker compose logs app' in $(pwd) show why."

docker compose exec -T app bun cli/selfhost.ts owner "$email"

app_url=$(sed -n 's/^APP_URL=//p' .env)
echo "tamari: running at $app_url"
if ! grep -q '^SMTP_HOST=.' .env; then
  echo "tamari: no email is set up (SMTP_* in .env are empty). Only the link above signs in; other people can't get a sign-in code until you fill those in and run 'docker compose up -d' here."
fi
