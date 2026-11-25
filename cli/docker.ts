// The container runtime (`runtime: docker` in .miso/miso.yaml), and a Dockerfile for any twin.
//
// A Dockerfile at the org repo's root builds the twin into one image: the shell release pinned in
// .miso/miso.yaml plus the spaces in .miso/spaces/ (cli/templates/docker/Dockerfile). Hosts that
// build from a Dockerfile (Dokploy, `docker build`) need nothing else from this CLI, and the
// Dockerfile works with any shell tag that has a vercel.json, because it does the assembly itself.
//
// With `runtime: docker` nothing runs on the Mac, so install and update only move the pin, as for
// vercel. A twin that also runs on a Mac (runtime: local) can have the same Dockerfile.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEMPLATES = join(import.meta.dir, 'templates', 'docker')

/** [template, target in the org repo root]. */
export const DOCKER_FILES: [string, string][] = [
  ['Dockerfile', 'Dockerfile'],
  ['dockerignore', '.dockerignore']
]

/** Writes the Dockerfile and .dockerignore unless the org already has them. */
export function writeDockerFiles(root: string): { wrote: string[]; kept: string[] } {
  const wrote: string[] = []
  const kept: string[] = []
  for (const [template, target] of DOCKER_FILES) {
    if (existsSync(join(root, target))) kept.push(target)
    else {
      copyFileSync(join(TEMPLATES, template), join(root, target))
      wrote.push(target)
    }
  }
  return { wrote, kept }
}
