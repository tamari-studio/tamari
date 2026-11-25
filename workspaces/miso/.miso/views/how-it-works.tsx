import { useEffect, useState } from 'react'
import {
  IconArrowDown,
  IconArrowRight,
  IconCheck,
  IconCircle,
  IconCircleCheck,
  IconCloudDataConnection,
  IconCopy,
  IconDeviceLaptop,
  IconFolders,
  IconLock
} from '@tabler/icons-react'
import { apiFetch } from 'miso'

import { setupSteps, type SetupStep } from '../lib/setup'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

export const config = {
  title: 'How Tamari works',
  icon: 'compass'
} as const

function cx(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(' ')
}

// Plain-language guide for everyone on the team, with a setup checklist on top for admins. Keep
// it true to the shell: spaces are built in code (workspaces/), the app keeps its state in Supabase.

const INTRO = [
  'Tamari is your team’s shared workspace. Each space in the sidebar is one area of work, with its own pages (tabs) and a dashboard of widgets.',
  'Tabs and dashboards are shared: a page you open or a widget you move, your whole team sees.',
  'Someone on your team builds new spaces, usually with a coding agent such as Claude Code. Ask an admin when you need one.'
]

const PARTS = [
  {
    icon: IconDeviceLaptop,
    title: 'The app',
    body: 'The sidebar, tabs, dashboards, sign-in and people. It works the same in every space.'
  },
  {
    icon: IconFolders,
    title: 'Your spaces',
    body: 'Pages and dashboard cards built for your team’s work. Each space shows what that area needs.'
  },
  {
    icon: IconCloudDataConnection,
    title: 'Your data',
    body: 'Spaces read it where it already lives, with keys an admin adds on the Connectors page. The Data map shows what each space uses.'
  }
]

const SERVER_ONLY = ['Connector keys', 'Database access', 'Server functions']

type Row = { task: string; how: string; copy?: string }

const IN_THE_APP: Row[] = [
  { task: 'Switch space', how: 'Click it in the left sidebar' },
  { task: 'Open another page', how: 'The + next to the tabs (tabs are shared: everyone on the space sees them)' },
  { task: 'Arrange a dashboard', how: 'Open the Widgets tab, then Edit widgets (the layout is the same for everyone)' },
  { task: 'Rename a space, change its font, color or corners', how: 'Settings → Organisation, under your name at the bottom of the sidebar (admins)' },
  { task: 'Add a space without code', how: 'Settings → Organisation, then Add space (admins)' },
  { task: 'Change your name', how: 'Settings → Personal' },
  { task: 'Add a key for space code', how: 'Connectors, in the sidebar' },
  { task: 'Let someone in or change their role', how: 'People & access, in the sidebar (admins)' },
  { task: 'Choose who sees a space', how: 'People & access, then Spaces (admins)' },
  { task: 'Put people in departments', how: 'People & access, then Departments (admins)' },
  { task: 'Report a problem', how: 'Feedback, in the sidebar' }
]

const BUILD: Row[] = [
  { task: 'Start the app', how: 'bun run dev', copy: 'bun run dev' },
  {
    task: 'Add a page',
    how: 'Ask your coding assistant: “Add a view to the … space that shows …”',
    copy: 'Add a view to the Tamari space that shows '
  },
  {
    task: 'Add a dashboard card',
    how: 'Ask your coding assistant: “Add a widget to the … space that shows …”',
    copy: 'Add a widget to the Tamari space that shows '
  },
  { task: 'Add a space', how: 'Ask your coding assistant (the prompt is in Get started), or see the README, "Add a space"' },
  { task: 'Check your work', how: 'bun run typecheck && bun run test', copy: 'bun run typecheck && bun run test' },
  { task: 'Keep keys safe', how: 'Views run in the browser; *.server.ts files run on the server. Keep keys and database access in server code.' },
  { task: 'A card says “No data”', how: 'A key is missing. Add it on the Connectors page' }
]

const GOOD_TO_KNOW = [
  'Keys added on the Connectors page stay on the server. Nobody can read them back, not even an admin.',
  'Something wrong or missing? Use Feedback in the sidebar: your admins see it and can mark it done.',
  'The first person to sign in becomes the owner. Everyone after waits until an admin gives them a role, unless their email domain is on the allowed list. New members pick their departments once, at first sign-in; after that an admin changes them.'
]

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={copied ? 'Copied' : label}>
      {copied ? <IconCheck stroke={1.75} /> : <IconCopy stroke={1.75} />}
    </Button>
  )
}

function CheatRows({ rows, commands }: { rows: Row[]; commands?: boolean }) {
  return (
    <div className="divide-y divide-border">
      {rows.map(row => (
        <div
          key={row.task}
          className="grid grid-cols-1 items-center gap-1 py-2.5 sm:grid-cols-[14rem_1fr_auto] sm:gap-4"
        >
          <div className="text-sm font-medium">{row.task}</div>
          <div
            className={cx(
              'min-w-0 text-sm text-muted-foreground',
              commands && row.copy && 'font-mono break-words'
            )}
          >
            {row.how}
          </div>
          <div className="flex h-7 w-7 justify-end">
            {row.copy && <CopyButton text={row.copy} label={`Copy: ${row.task}`} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="text-base font-medium">{children}</h2>
}

const SPACE_PROMPT =
  'Add a space to this Tamari app for <team or task>. It needs a page that shows <what you need>. ' +
  'Follow the README ("Add a space", "Rules for space code") and AGENTS.md, keep data access in a *.server.ts file, ' +
  'and run the typecheck, tests and build before you finish.'

// What each step says. `href` opens a shell page (a full load: space code doesn't drive the shell's router).
const STEPS: Record<SetupStep['id'], { title: string; body: string; href: string; link: string }> = {
  connect: {
    title: 'Connect a service',
    body: 'Add the keys your spaces need, such as an API token. They stay on the server.',
    href: '/connectors',
    link: 'Open Connectors'
  },
  people: {
    title: 'Let your team in',
    body: 'Send your team this page’s address. Each new person waits until you give them a role.',
    href: '/members',
    link: 'Open People & access'
  },
  departments: {
    title: 'Set up departments',
    body: 'Group people, then choose which spaces each department sees.',
    href: '/members/departments',
    link: 'Open Departments'
  },
  space: {
    title: 'Add your first space',
    body: 'Start from a template for your kind of team (`miso template list`), ask your coding agent to build one with the prompt below, or add a space without code in Settings → Organisation.',
    href: '/settings/organisation',
    link: 'Open Settings'
  }
}

type Facts = Parameters<typeof setupSteps>[0]

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return (await res.json()) as T
}

// Admins and owners only: /api/members refuses anyone else, so members never ask for it.
async function loadFacts(): Promise<Facts | null> {
  const me = await getJson<{ id: string; tier: string | null; status: string }>('/api/me')
  if (me.status !== 'active' || (me.tier !== 'owner' && me.tier !== 'admin')) return null
  const [connectors, members, departments, workspace] = await Promise.all([
    getJson<unknown[]>('/api/connectors'),
    getJson<{ members: { id: string; status: string }[] }>('/api/members'),
    getJson<unknown[]>('/api/departments'),
    getJson<{ spaces: unknown[] }>('/api/workspace')
  ])
  return {
    connectors: connectors.length,
    others: members.members.filter(m => m.id !== me.id && m.status === 'active').length,
    waiting: members.members.filter(m => m.status === 'pending').length,
    departments: departments.length,
    spaces: workspace.spaces.length
  }
}

function GetStarted() {
  const [facts, setFacts] = useState<Facts | null>(null)
  useEffect(() => {
    // A failed check just leaves the checklist out: the guide below still helps.
    loadFacts().then(setFacts, () => setFacts(null))
  }, [])
  if (!facts) return null
  const steps = setupSteps(facts)
  const left = steps.filter(s => !s.done).length
  return (
    <section className="flex flex-col gap-4 rounded-lg bg-card p-5 text-card-foreground ring-1 ring-border">
      <div className="flex flex-col gap-1">
        <SectionTitle>Get started</SectionTitle>
        <p className="text-sm text-muted-foreground">
          {left ? `For admins: ${left} of ${steps.length} first steps left.` : 'For admins: your workspace is set up.'}
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-border">
        {steps.map(step => {
          const text = STEPS[step.id]
          const Icon = step.done ? IconCircleCheck : IconCircle
          return (
            <li key={step.id} className="flex gap-3 py-3">
              <Icon stroke={1.75} size={20} className={cx('mt-0.5 shrink-0', step.done ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cx('text-sm font-medium', step.done && 'text-muted-foreground line-through')}>
                  {text.title}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </span>
                {!step.done && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {text.body}
                      {step.id === 'people' && facts.waiting > 0 && ` ${facts.waiting} waiting now.`}
                    </p>
                    {step.id === 'space' && (
                      <div className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs">
                        <code className="min-w-0 flex-1 break-words">{SPACE_PROMPT}</code>
                        <CopyButton text={SPACE_PROMPT} label="Copy the prompt" />
                      </div>
                    )}
                    <a href={text.href} className="w-fit text-sm font-medium underline underline-offset-4">
                      {text.link}
                    </a>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export default function HowItWorks() {
  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-10">
        <header className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium">How Tamari works</h1>
            <p className="text-sm text-muted-foreground">A one-page guide</p>
          </div>
          <ol className="flex flex-col gap-3">
            {INTRO.map((line, index) => (
              <li key={line} className="flex gap-3 text-base">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{index + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </header>

        <GetStarted />

        <section className="flex flex-col gap-4">
          <SectionTitle>How it fits together</SectionTitle>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {PARTS.map((part, index) => (
              <div key={part.title} className="contents">
                {index > 0 && (
                  <div className="flex justify-center text-muted-foreground">
                    <IconArrowRight stroke={1.75} size={16} className="hidden sm:block" />
                    <IconArrowDown stroke={1.75} size={16} className="sm:hidden" />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-2 self-stretch rounded-lg bg-card p-4 text-card-foreground ring-1 ring-border">
                  <div className="flex items-center gap-2">
                    <part.icon stroke={1.5} size={20} />
                    <span className="text-sm font-medium">{part.title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{part.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <IconLock stroke={1.75} size={16} />
              Stays on the server:
            </span>
            {SERVER_ONLY.map(item => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <SectionTitle>Cheatsheet</SectionTitle>
          <Tabs defaultValue="app">
            <TabsList>
              <TabsTrigger value="app">In the app</TabsTrigger>
              <TabsTrigger value="build">For builders</TabsTrigger>
            </TabsList>
            <TabsContent value="app" className="mt-2">
              <CheatRows rows={IN_THE_APP} />
            </TabsContent>
            <TabsContent value="build" className="mt-2">
              <p className="pt-2 text-sm text-muted-foreground">
                Run these in a terminal in the app's folder.
              </p>
              <CheatRows rows={BUILD} commands />
            </TabsContent>
          </Tabs>
        </section>

        <section className="flex flex-col gap-3 pb-4">
          <SectionTitle>Good to know</SectionTitle>
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm marker:text-muted-foreground">
            {GOOD_TO_KNOW.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
