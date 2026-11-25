// Workspace media a view can show through fileUrl() (/api/files/<folder>/<path>): which files
// count, and their types. The build copies them next to the API function (app/build.ts), which
// on Vercel has no spaces checkout to read them from.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export const MEDIA = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|mp3|wav|ogg|pdf)$/i

export const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  pdf: 'application/pdf'
}

// The servable media under a space folder, as paths relative to it: what /api/files would hand
// out. Dot folders (.miso, .shots, ...) and node_modules are skipped, as the route refuses them.
export function mediaFiles(dir: string, prefix = ''): string[] {
  let entries
  try {
    entries = readdirSync(join(dir, prefix), { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...mediaFiles(dir, rel))
    else if (entry.isFile() && MEDIA.test(entry.name)) out.push(rel)
  }
  return out
}
