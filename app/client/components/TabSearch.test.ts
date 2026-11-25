import { describe, expect, test } from 'bun:test'
import { matchesQuery, rankMatch } from './TabSearch'

describe('matchesQuery', () => {
  test('an empty query matches everything', () => {
    expect(matchesQuery('', 'Floorplan', 'Floorplan')).toBe(true)
  })
  test('matches the tab title or the space name, ignoring case', () => {
    expect(matchesQuery('floor', 'Floorplan', 'Events')).toBe(true)
    expect(matchesQuery('EVENTS', 'Floorplan', 'Events')).toBe(true)
  })
  test('every word has to match somewhere', () => {
    expect(matchesQuery('floor events', 'Floorplan', 'Events')).toBe(true)
    expect(matchesQuery('floor budget', 'Floorplan', 'Events')).toBe(false)
  })
})

describe('rankMatch', () => {
  test('the tab named exactly that comes first, then tab-name matches, then space-name matches', () => {
    expect(rankMatch('Data', 'Data', 'DTO')).toBe(0)
    expect(rankMatch('data', 'Data duplicates', 'DTO')).toBe(1)
    expect(rankMatch('data', 'Partners', 'Data')).toBe(2)
  })
  test('words split across tab and space still match, after tab-only matches', () => {
    expect(rankMatch('pipeline partners', 'Pipeline', 'Partners')).toBe(2)
  })
  test('no match is null', () => {
    expect(rankMatch('budget', 'Floorplan', 'Events')).toBeNull()
  })
})
