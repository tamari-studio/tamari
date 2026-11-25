// A small history router: the app has four kinds of page and no nesting.
//
//   /                         → the first space
//   /connectors, /shared-data, /members, /space-access, /usage, /proposals, /settings → workspace pages (/shared-data/<collection> for one collection;
//                               /members, /members/departments and /space-access are the tabs of People & access;
//                               /settings and /settings/organisation the tabs of Settings)
//   /<space>                  → that space's last tab
//   /<space>/widgets          → its widgets tab
//   /<space>/<view>           → a view whose folder has the space's slug (`/my-day/calendar`)
//   /<space>/<folder>/<view>  → any other view, such as one whose code lives in another space
import { useSyncExternalStore } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'connectors' }
  | { page: 'members'; tab?: 'departments' }
  | { page: 'space-access' }
  | { page: 'usage' }
  | { page: 'proposals' }
  | { page: 'settings'; tab?: 'organisation' }
  | { page: 'shared-data'; collection?: string }
  | { page: 'space'; slug: string; tab?: string }

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

// Guarded so the pure parts (parseRoute, tabPath) can be tested outside a browser.
if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return
  if (options.replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// A stray % (`/shared-data/100%`) would throw while App renders and blank the page.
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean).map(decodePart)
  if (parts.length === 0) return { page: 'home' }
  // Workspace pages are matched before spaces, so a space slugged like one would
  // be unreachable — router.test.ts checks every slug in spaces.json still
  // resolves to its space.
  if (parts[0] === 'connectors') return { page: 'connectors' }
  if (parts[0] === 'members') return parts[1] === 'departments' ? { page: 'members', tab: 'departments' } : { page: 'members' }
  if (parts[0] === 'space-access') return { page: 'space-access' }
  if (parts[0] === 'usage') return { page: 'usage' }
  if (parts[0] === 'proposals') return { page: 'proposals' }
  if (parts[0] === 'settings') return parts[1] === 'organisation' ? { page: 'settings', tab: 'organisation' } : { page: 'settings' }
  if (parts[0] === 'shared-data') return { page: 'shared-data', collection: parts[1] }
  const [slug, a, b] = parts
  if (a === 'widgets') return { page: 'space', slug, tab: 'widgets' }
  if (a && b) return { page: 'space', slug, tab: `view:${a}/${b}` }
  if (a) return { page: 'space', slug, tab: `view:${slug}/${a}` }
  return { page: 'space', slug }
}

/** `path` with the current query string kept, for the shell's redirects (`/` -> `/<space>`). */
export function keepQuery(path: string, search: string): string {
  const query = search.replace(/^\?/, '')
  return query ? `${path}?${query}` : path
}

export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => location.pathname)
  return parseRoute(pathname)
}

export function tabPath(slug: string, ref: string): string {
  if (ref === 'widgets') return `/${slug}/widgets`
  const [folder, name] = ref.slice('view:'.length).split('/')
  // The folder is left out when it repeats the slug (`/my-day/calendar`, not
  // `/my-day/my-day/calendar`). A view named `widgets` keeps it, or it would open the widgets tab.
  if (folder === slug && name !== 'widgets') return `/${slug}/${encodeURIComponent(name)}`
  return `/${slug}/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`
}
