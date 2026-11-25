import { useEffect, useState } from 'react'

import { getVault, type VaultData } from '../lib/vault.server'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; vault: Extract<VaultData, { configured: true }> } | { status: 'unconfigured' }

/** Loads the vault once and renders the loading, error and "not connected" states, so a view only draws the ready one. */
export function VaultPage({ title, count, children }: { title: string; count?: (v: Extract<VaultData, { configured: true }>) => string; children: (v: Extract<VaultData, { configured: true }>) => React.ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  useEffect(() => {
    getVault().then(
      v => setState(v.configured ? { status: 'ready', vault: v } : { status: 'unconfigured' }),
      e => setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    )
  }, [])
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h1 className="px-2 text-sm font-medium">{title}</h1>
        {state.status === 'ready' && count && <span className="text-xs text-muted-foreground tabular-nums">{count(state.vault)}</span>}
      </header>
      <main className="min-h-0 flex-1 overflow-auto rounded-tl-xl bg-background p-6 shadow-xs">
        <div className="mx-auto max-w-3xl">
          {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading the vault…</p>}
          {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
          {state.status === 'unconfigured' && (
            <p className="text-sm text-muted-foreground">
              No vault connected. On the Connectors page add a Custom connector with <code className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-xs">VAULT_REPO</code> (owner/name) and{' '}
              <code className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-xs">VAULT_TOKEN</code> (a GitHub token with read access to that repo's contents; to let people propose changes, read and write access to its contents and pull requests). Optional: <code className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-xs">VAULT_REF</code> for a branch.
            </p>
          )}
          {state.status === 'ready' && children(state.vault)}
        </div>
      </main>
    </div>
  )
}
