// Test helper: a Space access store in memory, standing in for miso.space_access.
import type { SpaceAccessRule } from '../lib/types'
import type { SpaceAccessStore } from './space-access'

export function memorySpaceAccessStore(rules: SpaceAccessRule[] = []): SpaceAccessStore & { rules: SpaceAccessRule[] } {
  return {
    rules,
    async list() {
      return rules.map(r => ({ ...r, tiers: [...r.tiers] }))
    },
    // Departments aren't expanded here: `members` is the people only.
    async set(spaceId, change) {
      const rule = { spaceId, ...change, members: [...change.people] }
      const at = rules.findIndex(r => r.spaceId === spaceId)
      if (at < 0) rules.push(rule)
      else rules[at] = rule
    },
    async reset(spaceId) {
      const at = rules.findIndex(r => r.spaceId === spaceId)
      if (at >= 0) rules.splice(at, 1)
    }
  }
}
