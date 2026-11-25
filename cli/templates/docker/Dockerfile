# syntax=docker/dockerfile:1
#
# This twin as one image: the Tamari release pinned in .miso/miso.yaml (`version:`), built with the
# spaces in .miso/spaces/ copied in as real files, and served with bun on one port. Written by
# `miso init --runtime docker` or `miso docker init`; the org owns the copy.
#
#   docker build -t miso-twin .
#   docker run -p 13380:13380 -e SUPABASE_URL=... -e SUPABASE_PUBLISHABLE_KEY=... -e SUPABASE_SECRET_KEY=... miso-twin
#
# The app's keys are environment variables of the container, never part of the image. The image holds
# no key, and the build leaves no token behind.
#
# The shell repo is private. Pass a read-only token as the build secret MISO_SHELL_TOKEN:
#   MISO_SHELL_TOKEN=<token> docker build --secret id=MISO_SHELL_TOKEN,env=MISO_SHELL_TOKEN .
# (Dokploy: the application's Environment tab, "Build-time Secrets".) A fine-grained token with
# Repository permissions: Contents = Read-only on the shell repo is enough; docs/org-repos.md has more.
#
# A shell that GitHub doesn't have yet (a tag you haven't pushed), or no network to it: build from a
# local git checkout or bare clone that has the pinned tag:
#   docker build --build-context shell-source=/path/to/tamari .

# Empty unless --build-context shell-source=... fills it.
FROM scratch AS shell-source

FROM oven/bun:1.3.14 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /twin
COPY .miso/miso.yaml .miso/miso.yaml
COPY .miso/spaces .miso/spaces
COPY --from=shell-source / /shell-source/

# The pinned shell, then the org's spaces in place of its own: real files, links followed.
RUN --mount=type=secret,id=MISO_SHELL_TOKEN <<'SH'
set -eu
repo=$(sed -n 's/^shell: *\([^ #]*\).*/\1/p' .miso/miso.yaml)
tag=$(sed -n 's/^version: *\([^ #]*\).*/\1/p' .miso/miso.yaml)
if [ -z "$repo" ] || [ -z "$tag" ] || [ "$tag" = none ]; then
  echo "miso: .miso/miso.yaml needs a shell: and a version: (run 'miso update' and commit it)." >&2
  exit 1
fi
if [ -n "$(ls -A /shell-source 2>/dev/null)" ]; then
  echo "miso: cloning $tag from the shell-source build context"
  git clone --quiet --depth 1 --branch "$tag" file:///shell-source /build
else
  echo "miso: cloning $repo $tag"
  auth=""
  if [ -s /run/secrets/MISO_SHELL_TOKEN ]; then
    basic=$(printf 'x-access-token:%s' "$(cat /run/secrets/MISO_SHELL_TOKEN)" | base64 -w0)
    auth="http.https://github.com/.extraheader=AUTHORIZATION: basic $basic"
  fi
  # GIT_TERMINAL_PROMPT=0: a private repo without a token fails at once instead of asking.
  if ! GIT_TERMINAL_PROMPT=0 git ${auth:+-c "$auth"} clone --quiet --depth 1 --branch "$tag" "https://github.com/$repo.git" /build; then
    echo "miso: could not clone $repo $tag. If the repo is private, pass the build secret MISO_SHELL_TOKEN (see the top of this Dockerfile)." >&2
    exit 1
  fi
fi
rm -rf /build/workspaces /build/spaces.json
mkdir /build/workspaces
for dir in .miso/spaces/*/; do
  [ -d "$dir" ] && cp -RL "$dir" "/build/workspaces/$(basename "$dir")"
done
cp .miso/spaces/spaces.json /build/spaces.json
SH

WORKDIR /build
RUN bun install --frozen-lockfile
RUN bun run build
# Nothing in the image needs the clone's history.
RUN rm -rf /build/.git

FROM oven/bun:1.3.14 AS run
WORKDIR /app
COPY --from=build --chown=bun:bun /build /app
# serve.ts listens on 127.0.0.1 unless told otherwise; a container must listen on every address.
ENV PORT=13380 HOST=0.0.0.0
USER bun
EXPOSE 13380
# /api/health answers 200 only when the keys work and the database has the shell's schema, so
# "healthy" means configured, connected and serving.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 13380) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "app/serve.ts"]
