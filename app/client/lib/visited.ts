// The views a space keeps mounted (SpaceScreen.tsx): the last `keep` visited,
// `ref` last, never twice. An update that runs twice (StrictMode runs effects
// twice) must not add the same view again: two children with one key mount it twice.
export function visit(visited: string[], ref: string, keep: number): string[] {
  return visited.includes(ref) ? visited : [...visited.slice(-(keep - 1)), ref]
}
