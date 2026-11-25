import { expect, test } from 'bun:test'

import { APP_NAME } from '../../lib/brand'
import { placeCard, TOUR_STEPS, visibleSteps } from './onboarding'

test('a step whose anchor is not on screen is left out; steps without one always stay', () => {
  const member = visibleSteps(TOUR_STEPS, target => !['menu', 'members', 'space-access', 'usage'].includes(target))
  expect(member.map(s => s.target)).toEqual([undefined, 'spaces', 'tabs', 'add-tab', undefined, 'connectors', 'account', 'feedback', 'tour'])
  expect(visibleSteps(TOUR_STEPS, () => true)).toHaveLength(TOUR_STEPS.length)
  // A phone has no sidebar: the steps that need no anchor are still a tour.
  expect(visibleSteps(TOUR_STEPS, () => false).map(s => s.title)).toEqual([`Welcome to ${APP_NAME}`, 'Search'])
  // On a touch screen the keyboard shortcut is left out too.
  expect(visibleSteps(TOUR_STEPS, () => false, true).map(s => s.title)).toEqual([`Welcome to ${APP_NAME}`])
})

test('every anchor is named once', () => {
  const targets = TOUR_STEPS.flatMap(s => (s.target ? [s.target] : []))
  expect(new Set(targets).size).toBe(targets.length)
})

const view = { width: 1200, height: 800 }
const card = { width: 320, height: 160 }

test('the card sits beside a sidebar row, under the tab strip, and in the middle without an anchor', () => {
  expect(placeCard({ top: 600, left: 12, width: 200, height: 32 }, card, view)).toEqual({ top: 600, left: 224 })
  expect(placeCard({ top: 0, left: 240, width: 900, height: 48 }, card, view)).toEqual({ top: 60, left: 240 })
  expect(placeCard(null, card, view)).toEqual({ top: 320, left: 440 })
})

test('the card stays inside the window', () => {
  // A row at the very bottom: beside it, pushed up.
  expect(placeCard({ top: 780, left: 12, width: 200, height: 32 }, card, view)).toEqual({ top: 632, left: 224 })
  // No room beside or under: over it.
  expect(placeCard({ top: 700, left: 1000, width: 190, height: 60 }, card, view)).toEqual({ top: 528, left: 872 })
  // A window smaller than the card.
  expect(placeCard(null, card, { width: 300, height: 100 })).toEqual({ top: 8, left: 8 })
})
