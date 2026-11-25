// The Feedback dialog's pure parts, kept apart so they can be tested without a browser.
import type { Space } from '../../lib/types'
import { usageTargetLabel } from './labels'
import { parseRoute } from './router'

const TITLE_MAX = 200

// The dialog asks for one piece of text, but the API (and the issue list) wants a title:
// the first line that says something, cut to what the server accepts.
export function titleFrom(text: string): string {
  const line = text.split('\n').find(l => l.trim())?.trim() ?? ''
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

// A stored page path (`/sales/crm/pipeline`) as the person knows it: "Sales · Pipeline".
// Anything this build can't name shows as the path itself.
export function pageLabel(path: string, spaces: Pick<Space, 'slug' | 'previousSlugs' | 'name'>[], applets: ReadonlyMap<string, { title: string; name: string }>): string {
  const route = parseRoute(path)
  if (route.page === 'home') return 'Home'
  if (route.page !== 'space') return usageTargetLabel(`page:${route.page}`, applets)
  const space = spaces.find(s => s.slug === route.slug || s.previousSlugs.includes(route.slug))
  if (!space) return path
  return route.tab ? `${space.name} · ${usageTargetLabel(route.tab, applets)}` : space.name
}
