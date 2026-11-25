# syntax=docker/dockerfile:1
#
# The app of the Compose install, built from this checkout (docker-compose.yml builds it with the
# repo root as context). No key is in the image: the compose file passes them in at start.
FROM oven/bun:1.3.14 AS build
# The build asks git for the commit; without .git in the context it gets none, which is fine.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM oven/bun:1.3.14 AS run
# git: the app rebuilds at start and on changes, and the spaces volume keeps its history in git.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=bun:bun /build /app
# The spaces live in a volume at /app/workspaces, spaces.json included (docker-compose.yml). The
# image keeps the spaces this repo ships in shell-spaces/, and every start copies them into the
# volume (cli/selfhost.ts). dist/ is the build of exactly those, served when the volume's spaces
# don't build.
RUN mkdir shell-spaces && mv workspaces shell-spaces/workspaces && mv spaces.json shell-spaces/spaces.json \
  && mkdir workspaces && ln -s workspaces/spaces.json spaces.json && chown -R bun:bun shell-spaces workspaces && chown bun:bun /app
# serve.ts listens on 127.0.0.1 unless told otherwise; a container must listen on every address.
ENV PORT=13380 HOST=0.0.0.0
USER bun
EXPOSE 13380
# /api/health answers 200 only when the keys work and the database has the shell's schema. The
# check ends itself after 4 s: Docker doesn't stop a check that outlives its timeout, so against a
# server that accepts and never answers, checks would pile up.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 13380) + '/api/health', { signal: AbortSignal.timeout(4000) }).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Migrations, the service accounts, the spaces volume, a build, then the app (cli/selfhost.ts).
CMD ["bun", "cli/selfhost.ts", "start"]
