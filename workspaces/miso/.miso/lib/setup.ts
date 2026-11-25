// The admin's "Get started" checklist on the guide page: which first steps a new workspace has done.
// Read from the shell's own API as the signed-in admin (see views/how-it-works.tsx).

export type SetupFacts = {
  connectors: number
  // Active people other than you, and people waiting for a role.
  others: number
  waiting: number
  departments: number
  spaces: number
}

export type SetupStep = { id: 'connect' | 'people' | 'departments' | 'space'; done: boolean }

export function setupSteps(facts: SetupFacts): SetupStep[] {
  return [
    { id: 'connect', done: facts.connectors > 0 },
    // Someone else is in and nobody is left waiting.
    { id: 'people', done: facts.others > 0 && facts.waiting === 0 },
    { id: 'departments', done: facts.departments > 0 },
    // A new install has one space; a second one is the team's own.
    { id: 'space', done: facts.spaces > 1 }
  ]
}
