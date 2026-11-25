import { IconCheck, IconCopy } from '@tabler/icons-react'
import { useMemo, useState } from 'react'

import { describeSkill } from '../lib/skills'
import { VaultPage } from './_vault'

export const config = { title: 'Skills', icon: 'sparkles' } as const

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${text}`}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <IconCheck size={16} stroke={1.75} /> : <IconCopy size={16} stroke={1.75} />}
    </button>
  )
}

export default function Skills() {
  const [query, setQuery] = useState('')
  return (
    <VaultPage title="Skills" count={v => (v.skills.length === 1 ? '1 skill' : `${v.skills.length} skills`)}>
      {vault => <List skills={vault.skills} repo={vault.repo} query={query} setQuery={setQuery} />}
    </VaultPage>
  )
}

function List({ skills, repo, query, setQuery }: { skills: Parameters<typeof describeSkill>[0][]; repo: string; query: string; setQuery: (q: string) => void }) {
  const views = useMemo(() => skills.map(describeSkill), [skills])
  const q = query.trim().toLowerCase()
  const shown = q ? views.filter(s => `${s.command} ${s.summary} ${s.when ?? ''}`.toLowerCase().includes(q)) : views
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Type these in Claude Code, inside the {repo} vault.</p>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills" className="h-9 rounded-md border bg-background px-3 text-sm" />
      {shown.length === 0 && <p className="text-sm text-muted-foreground">{views.length === 0 ? 'No skills in .claude/skills of this vault.' : 'No skill matches.'}</p>}
      <ul className="flex flex-col gap-0.5">
        {shown.map(s => (
          <li key={s.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-accent">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span>
                <code className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-xs select-all">{s.command}</code>
              </span>
              {s.summary && <span className="text-sm">{s.summary}</span>}
              {s.when && <span className="text-xs text-muted-foreground">Use {s.when}</span>}
            </div>
            <Copy text={s.command} />
          </li>
        ))}
      </ul>
    </div>
  )
}
