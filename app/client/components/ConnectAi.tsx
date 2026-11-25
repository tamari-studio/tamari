// Settings → Personal → Connect your AI: the address a member pastes into their own AI tool, their
// connection tokens (made here, shown once, deleted here), and the steps per tool. The server side
// is app/server/mcp.ts; a token lets the tool read as this member. The one thing it can make is a
// proposal to change a vault note, which a person reviews. "Copy setup prompt" makes a token and a
// prompt to paste into a coding agent in one click; the banner (ConnectAgentBanner) leads here.
import { IconCopy, IconTerminal2, IconTrash } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { APP_NAME } from '../../lib/brand'
import { api } from '../lib/http'
import { useMe } from '../lib/queries'
import { toast } from '../lib/toast'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { cn } from '../ui/utils'
import { useConfirm } from './ConfirmDialog'

type AiToken = { id: string; name: string; createdAt: string; lastUsedAt: string | null; editsSpaces: boolean }
type AiTokenList = { available: boolean; editsAvailable?: boolean; tokens: AiToken[] }

const KEY = ['ai-tokens'] as const
const connected = (list?: AiTokenList) => !list?.available || list.tokens.some(t => t.lastUsedAt)
// `watch`: asked again every 15 s and on focus until a token is used (the banner), so connecting shows without a reload.
export const useAiTokens = (watch = false) =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<AiTokenList>('/api/ai-tokens'),
    ...(watch ? { refetchOnWindowFocus: true, refetchInterval: (q: { state: { data?: AiTokenList } }) => (connected(q.state.data) ? false : 15_000) } : {})
  })
// The section's address, for the banner and links: /settings#connect-ai.
export const CONNECT_AI_ID = 'connect-ai'

const serverName = APP_NAME.toLowerCase()
const addCommand = (address: string, token: string) => `claude mcp add --transport http ${serverName} ${address} --header "Authorization: Bearer ${token}"`

/** What the person pastes into their coding agent: what this is, the command, and the check. */
export function setupPrompt(address: string, token: string): string {
  return [
    `${APP_NAME} is my company's workspace app: spaces with views, widgets and shared records, which you can read and build over MCP.`,
    `Connect to it by running this command:`,
    '',
    addCommand(address, token),
    '',
    `Then ask me to restart you or run /mcp, so the ${serverName} tools load. Call the ${serverName} whoami tool and tell me the result.`
  ].join('\n')
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function copy(text: string, what: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast(`${what} copied.`),
    () => toast(`Couldn't copy. Select the text and copy it yourself.`, 'error')
  )
}

function Copyable({ text, what, label }: { text: string; what: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <code aria-label={label} className="min-w-0 flex-1 rounded-md border bg-muted/50 px-2.5 py-1.5 font-mono text-xs break-all whitespace-pre-wrap select-all">
        {text}
      </code>
      <Button type="button" variant="outline" size="icon-sm" aria-label={`Copy ${what.toLowerCase()}`} title="Copy" onClick={() => copy(text, what)}>
        <IconCopy stroke={1.75} />
      </Button>
    </div>
  )
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">{children}</div>
    </div>
  )
}

// The token and prompt from "Copy setup prompt": shown in this dialog only, never again once it closes.
function SetupDialog({ token, address, onClose }: { token: string; address: string; onClose: () => void }) {
  const [tab, setTab] = useState<'claude' | 'other'>('claude')
  const prompt = setupPrompt(address, token)
  // Copied on open, as the button promised; the Copy buttons are there if the browser refused.
  const copied = useRef(false)
  useEffect(() => {
    if (!copied.current) copy(prompt, 'Prompt')
    copied.current = true
  }, [prompt])
  return (
    // Closing loses the token for good, so only its buttons close it.
    <Dialog open onOpenChange={open => !open && onClose()} disablePointerDismissal>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Paste this into your coding agent</DialogTitle>
          <DialogDescription>It holds a new token, which you won't see again once you close this.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 border-b" role="tablist" aria-label="Coding agent">
          {(
            [
              ['claude', 'Claude Code'],
              ['other', 'Other agents']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                tab === id ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'claude' ? (
          <div className="flex flex-col gap-1.5">
            <Copyable text={prompt} what="Prompt" label="Prompt for Claude Code" />
            <p className="text-xs text-muted-foreground">Paste it into Claude Code. It adds {APP_NAME}, then checks the connection once you restart it or run /mcp.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">Any agent that speaks MCP over HTTP and lets you set a header, such as Codex: give it this address and token.</p>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">Address</span>
              <Copyable text={address} what="Address" label="MCP address" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">Token</span>
              <Copyable text={token} what="Token" label="Your new token" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">Header, for agents that take one</span>
              <Copyable text={`Authorization: Bearer ${token}`} what="Header" label="Authorization header with your token" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConnectAi() {
  const qc = useQueryClient()
  const list = useAiTokens()
  // Opened from the banner (/settings#connect-ai): bring the section into view.
  useEffect(() => {
    if (window.location.hash === `#${CONNECT_AI_ID}`) document.getElementById(CONNECT_AI_ID)?.scrollIntoView({ block: 'start' })
  }, [])
  const [setup, setSetup] = useState<string | null>(null)
  const [name, setName] = useState('')
  // "May change spaces": every member. A member's tool changes only their own drafts; an admin's or
  // owner's changes any space (server/mcp-space-tools.ts checks the role again on every change).
  const tier = useMe().data?.tier
  const canEdit = tier != null
  const admin = tier === 'admin' || tier === 'owner'
  const [edits, setEdits] = useState(false)
  // The token just made: shown until the person leaves the page, and never again.
  const [made, setMade] = useState<{ name: string; token: string; editsSpaces: boolean } | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const create = useMutation({
    mutationFn: (tokenName: string) => api<AiToken & { token: string }>('/api/ai-tokens', { method: 'POST', body: { name: tokenName, editsSpaces: canEdit && edits } }),
    onSuccess: token => {
      setMade({ name: token.name, token: token.token, editsSpaces: token.editsSpaces })
      setName('')
      setEdits(false)
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: error => toast(error.message, 'error')
  })
  // One click: a token that may change spaces (every member may make one), then the prompt dialog.
  const makeSetup = useMutation({
    mutationFn: () =>
      api<AiToken & { token: string }>('/api/ai-tokens', {
        method: 'POST',
        body: { name: `Coding agent, ${day(new Date().toISOString())}`, editsSpaces: canEdit && list.data?.editsAvailable !== false }
      }),
    onSuccess: token => {
      setSetup(token.token)
      void qc.invalidateQueries({ queryKey: KEY })
    },
    onError: error => toast(error.message, 'error')
  })
  const remove = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/ai-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => toast('Token deleted. Tools that used it are disconnected.'),
    onError: error => toast(error.message, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY })
  })

  const address = `${window.location.origin}/api/mcp`
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
  const shownToken = made?.token ?? '<your token>'
  const trimmed = name.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (trimmed && !create.isPending) create.mutate(trimmed)
  }

  return (
    <section id={CONNECT_AI_ID} className="flex scroll-mt-6 flex-col gap-4 rounded-xl border bg-background p-5 shadow-xs">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Connect your AI</h2>
        <p className="text-sm text-muted-foreground">
          Let your own AI tool read this workspace as you: the spaces you see, shared records and vault notes. It sees what you see and
          changes nothing. It can propose a change to a vault note in your name, as a pull request that developers review on GitHub.
        </p>
      </div>

      {list.data?.available && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-sm">
            <span className="font-medium">Set up your coding agent in one paste.</span>{' '}
            <span className="text-muted-foreground">This makes a token for it and copies a prompt that connects it and checks the connection.</span>
          </p>
          <Button size="sm" onClick={() => makeSetup.mutate()} disabled={makeSetup.isPending}>
            <IconTerminal2 stroke={1.75} />
            {makeSetup.isPending ? 'Making a token…' : 'Copy setup prompt'}
          </Button>
        </div>
      )}
      {setup && <SetupDialog token={setup} address={address} onClose={() => setSetup(null)} />}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">Address</span>
        <Copyable text={address} what="Address" label="Address to paste into your AI tool" />
        {local && <p className="text-xs text-muted-foreground">This address is on this computer, so only tools that run on this computer reach it.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Your tokens</span>
        {list.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : list.isError ? (
          <p className="text-sm text-destructive">Couldn't load your tokens. Reload the page to try again.</p>
        ) : !list.data.available ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Connecting an AI isn't set up on this workspace yet. Whoever runs it needs to apply the latest database migration.
          </p>
        ) : (
          <>
            {list.data.tokens.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet. Make one for each tool you connect.</p>}
            {list.data.tokens.map(token => (
              <div key={token.id} className="flex items-center gap-3 text-sm">
                {/* On a phone the dates go under the name, so the name keeps its room. */}
                <div className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-center">
                  <span className="min-w-0 truncate font-medium sm:flex-1">{token.name}</span>
                  <span className="text-xs text-muted-foreground sm:shrink-0">
                    {token.editsSpaces ? 'May change spaces · ' : ''}Made {day(token.createdAt)} · {token.lastUsedAt ? `last used ${day(token.lastUsedAt)}` : 'never used'}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${token.name}`}
                  title="Delete token"
                  onClick={() =>
                    confirm({
                      title: `Delete ${token.name}?`,
                      description: 'The tool that uses this token is disconnected at once. You can make a new token at any time.',
                      action: 'Delete token',
                      destructive: true,
                      run: () => {
                        remove.mutate(token.id)
                        if (made?.name === token.name) setMade(null)
                      }
                    })
                  }
                >
                  <IconTrash stroke={1.75} className="text-destructive" />
                </Button>
              </div>
            ))}
            <form onSubmit={submit} className="flex items-center gap-2">
              <Input value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Name, for example Claude Code on my laptop" aria-label="Name of the new token" className="flex-1" />
              <Button type="submit" size="sm" disabled={!trimmed || create.isPending}>
                {create.isPending ? 'Making…' : 'Make token'}
              </Button>
            </form>
            {canEdit && list.data.editsAvailable !== false && (
              <label className="flex items-start gap-3 text-sm">
                <Switch checked={edits} onCheckedChange={setEdits} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span>May change spaces</span>
                  <span className="text-xs text-muted-foreground">
                    {admin
                      ? 'The tool can create spaces and change their code, tabs and widgets.'
                      : 'The tool can make draft spaces that only you see, and change their code, tabs and widgets.'}{' '}
                    Only on a self-hosted {APP_NAME}. Set when the token is made.
                  </span>
                </span>
              </label>
            )}
            {made && (
              <div className="flex flex-col gap-1.5 rounded-md border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium">Copy the token for {made.name} now. You won't see it again.</p>
                <Copyable text={made.token} what="Token" label="Your new token" />
                <p className="text-xs text-muted-foreground">
                  Treat it like a password: anyone who has it can read what you can read here{made.editsSpaces ? ', and change spaces' : ''}.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t pt-4">
        <Step title="Claude Code">
          <p>Run this in a terminal, with your token in place:</p>
          <Copyable
            text={addCommand(address, shownToken)}
            what="Command"
            label="Command for Claude Code"
          />
          <p>Then type /mcp in Claude Code to check that {APP_NAME.toLowerCase()} is connected.</p>
        </Step>
        <Step title="Claude (web, desktop and phone)">
          <p>
            Not yet for most people. Claude adds a connector by sending you to a sign-in page, and {APP_NAME} works with a token for now. Claude
            also connects from the internet, so {APP_NAME} must be online at an https address first.
          </p>
          <p>
            Some organisations can add a fixed request header when their owner adds a custom connector. Don't put your token there: everyone in
            the organisation would then read as you.
          </p>
        </Step>
        <Step title="ChatGPT">
          <p>Not yet. ChatGPT only connects to tools that offer a sign-in page, and {APP_NAME} works with a token for now.</p>
        </Step>
        <Step title="Other tools">
          <p>
            Any tool that speaks the Model Context Protocol over HTTP and lets you set a header works: give it the address and the header{' '}
            <code className="font-mono text-xs">Authorization: Bearer {shownToken}</code>.
          </p>
        </Step>
      </div>
      {confirmDialog}
    </section>
  )
}
