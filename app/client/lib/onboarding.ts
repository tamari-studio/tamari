// The welcome step and the tour: what the tour says, which of its steps a viewer gets, where its
// card sits, and whether this person has been through each already.

import { APP_NAME } from '../../lib/brand'

export type TourStep = {
  // A `data-tour` anchor in the shell. Without one the step sits in the middle of the screen.
  target?: string
  title: string
  body: string
  // About the keyboard: left out on a touch screen.
  keyboard?: boolean
}

// One sentence on what it is and why you'd care, for a colleague who has never seen the app.
// Anchors are sidebar rows and the tab strip, not page internals, so pages can change freely.
export const TOUR_STEPS: TourStep[] = [
  {
    title: `Welcome to ${APP_NAME}`,
    body: `${APP_NAME} is where your shared tools and numbers live. This tour shows you around in about a minute; press Esc to leave it at any time.`
  },
  {
    // Only on a phone, where the sidebar is this menu.
    target: 'menu',
    title: 'The menu',
    body: 'Everything is in this menu: your spaces, Connectors, the Data map, Feedback and this tour.'
  },
  {
    target: 'spaces',
    title: 'Spaces',
    body: 'Each space is one area of work, such as a team or a project. Pick one here to open its tools; you see the spaces meant for you and your team.'
  },
  {
    target: 'tabs',
    title: 'Tabs and views',
    body: 'A space is split into tabs. Each tab is a view, such as a list, a board or a report. The tabs are shared: a tab anyone opens or closes here does so for everyone on this space.'
  },
  {
    target: 'add-tab',
    title: 'More views, and widgets',
    body: 'Press + to open another view for the whole space. Widgets are small live cards, such as a count or a chart, that sit together on the shared Widgets tab so everyone sees what matters at a glance.'
  },
  {
    keyboard: true,
    title: 'Search',
    body: 'Press ⌘K (Ctrl+K on Windows) and type a name to jump straight to any open tab in any space.'
  },
  {
    target: 'connectors',
    title: 'Connectors',
    body: `Connectors link ${APP_NAME} to the other tools you use, so their information shows up in your spaces. This page shows what is connected.`
  },
  {
    target: 'account',
    title: 'Your menu',
    body: 'Hover your name for the Data map, which shows what information the workspace holds and which spaces use each piece, and for your Settings.'
  },
  {
    target: 'members',
    title: 'People & access',
    body: 'For admins: everyone who has signed in, the role each person has, the teams they belong to, and which teams and people see each space.'
  },
  {
    target: 'usage',
    title: 'Usage',
    body: 'For admins: which spaces and views people actually open, so you know what is worth keeping up.'
  },
  {
    target: 'feedback',
    title: 'Feedback',
    body: 'Something broken, confusing or missing? Tell us here and follow what happens to it.'
  },
  {
    target: 'tour',
    title: "That's it",
    body: 'You can take this tour again from here whenever you like.'
  }
]

// A step whose anchor isn't on screen is left out: a page this tier doesn't get, or the sidebar on a phone.
export function visibleSteps(steps: readonly TourStep[], isVisible: (target: string) => boolean, touch = false): TourStep[] {
  return steps.filter(step => (!step.target || isVisible(step.target)) && !(touch && step.keyboard))
}

export type Box = { top: number; left: number; width: number; height: number }

const MARGIN = 8

// Beside the anchor when there is room (sidebar rows), else under it (the tab strip), else over
// it; always inside the window. No anchor: the middle.
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 12
): { top: number; left: number } {
  const clamp = (value: number, size: number, max: number) => Math.max(MARGIN, Math.min(value, max - size - MARGIN))
  if (!target) return { top: clamp((view.height - card.height) / 2, card.height, view.height), left: clamp((view.width - card.width) / 2, card.width, view.width) }
  const right = target.left + target.width + gap
  if (right + card.width <= view.width - MARGIN) return { top: clamp(target.top, card.height, view.height), left: right }
  const below = target.top + target.height + gap
  const top = below + card.height <= view.height - MARGIN ? below : target.top - gap - card.height
  return { top: clamp(top, card.height, view.height), left: clamp(target.left, card.width, view.width) }
}

// shortcut: "seen" is kept per browser (localStorage), so a second device or a cleared browser
// shows the welcome step (until they are in a department) and the tour again; upgrade to a
// per-member flag in the database if people complain.
export type Seen = 'welcomed' | 'tour'

const seenKey = (what: Seen, userId: string) => `miso:${what}:${userId}`

export function hasSeen(what: Seen, userId: string): boolean {
  try {
    return localStorage.getItem(seenKey(what, userId)) === '1'
  } catch {
    // Storage blocked: better to skip the tour than to show it on every load.
    return true
  }
}

export function markSeen(what: Seen, userId: string): void {
  try {
    localStorage.setItem(seenKey(what, userId), '1')
  } catch {
    // Storage blocked: nothing to remember it in.
  }
}

// The sidebar's "Take the tour" row asks; Onboarding listens.
const TOUR_EVENT = 'miso:tour'

export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT))
}

export function onStartTour(listener: () => void): () => void {
  window.addEventListener(TOUR_EVENT, listener)
  return () => window.removeEventListener(TOUR_EVENT, listener)
}
