// The tools that read and change spaces' code over MCP (server/mcp.ts registers them). Only in the
// Compose install, where the spaces are a volume with git inside (server/space-files.ts).
//
//   • Reading (list_space_files, read_space_file, get_design_rules): any member, in a space they see.
//   • Changing (change_space_files, create_space, edit_tabs, edit_layout, delete_draft_space): a
//     token made with "May change spaces" on. An admin or owner (at the time of the call) changes
//     any of the company's spaces; a member makes and changes only their own draft spaces, which
//     nobody else's sidebar shows and whose server functions don't run (server/drafts.ts). A
//     member's change to another space they see goes into their own draft copy of it, which they
//     send to the admins with submit_proposal (server/proposals.ts). Never one of Tamari's own
//     spaces (spaces-volume.ts, shippedFolders()).
//   • change_space_files is one build and one commit, or everything put back with the build's errors.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { APP_NAME } from '../lib/brand'
import { APP_ROOT } from '../lib/roots'
import { waitForBuild } from './build-status'
import { ToolRefusal, tool, type Tool, type ToolContext } from './mcp-tools'
import {
  applyFiles,
  checkChange,
  checkDraftCap,
  checkSummary,
  FileRefusal,
  listFiles,
  planSpace,
  spaceFiles,
  readFile,
  runChange,
  spaceEntry,
  spaceFolder,
  spaceTrackedFiles,
  isOwnDraft,
  removeSpace,
  writeSpace,
  type ChangeResult,
  type Editor,
  type SpaceEntry,
  type NewSpace
} from './space-files'
import { refuseIfSent, submitProposal, withdrawForFolder } from './proposal-flow'
import { copyChangeFiles, findCopy, planCopy, writeCopy } from './proposals'
import { shippedFolders } from './spaces-volume'
import { vaultClient } from './supabase'

const READ_ONLY_TOKEN = 'This connection token can only read. To change spaces, make a token with "May change spaces" on in Settings → Connect your AI, and use that one.'
const NOT_MEMBER = 'This account is not an active member of this workspace any more.'

// The tier as it is now, not as the sign-in cache had it up to a minute ago (auth.ts): a member
// whose role was just taken away must not write server code for another minute.
async function requireEditor(ctx: ToolContext): Promise<Editor> {
  if (!ctx.editsSpaces) throw new ToolRefusal(READ_ONLY_TOKEN)
  const tier = ctx.currentTier ? await ctx.currentTier() : null
  if (!tier) throw new ToolRefusal(NOT_MEMBER)
  return { userId: ctx.user.id, admin: tier === 'admin' || tier === 'owner' }
}

// A space-files refusal is said to the AI as it is.
async function said<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof FileRefusal) throw new ToolRefusal(err.message)
    throw err
  }
}

async function seenEntry(ctx: ToolContext, space: string, edit?: Editor): Promise<SpaceEntry> {
  const entry = await said(() => spaceEntry(space, { edit }))
  if ((await ctx.hidden()).folders.has(entry.folder)) throw new ToolRefusal(`The ${space} space isn't available to you in this workspace.`)
  return entry
}

const seenFolder = async (ctx: ToolContext, space: string, edit?: Editor): Promise<string> => (await seenEntry(ctx, space, edit)).folder

function api(ctx: ToolContext) {
  if (!ctx.api) throw new ToolRefusal('This server cannot change tabs or layouts.')
  return ctx.api
}

type WorkspaceView = { spaces: { id: string; slug: string }[]; tabs: { id: string; spaceId: string; ref: string; position: number }[] }

// `knownId`: the space a check already resolved (a member's own draft), so the change lands on that one.
async function spaceId(ctx: ToolContext, slug: string, knownId?: string): Promise<{ id: string; workspace: WorkspaceView }> {
  const workspace = (await api(ctx)('GET', '/api/workspace')) as WorkspaceView
  const found = workspace.spaces.find(s => (knownId ? s.id === knownId : s.slug === slug))
  if (!found) throw new ToolRefusal(`There's no space ${JSON.stringify(slug)} in the app yet. A new space shows up once its build is served; try again in a moment.`)
  return { id: found.id, workspace }
}

function outcome(result: ChangeResult): unknown {
  if (result.status === 'put back') {
    return { status: 'put back', errors: result.errors, next: 'Nothing was kept: every file is as it was. Fix what the errors say and send the whole change again.' }
  }
  return result
}

const spaceArg = z.string().min(1).max(100).describe("The space's slug, from list_spaces.")
const pathArg = z.string().min(1).max(200).describe("A path inside the space's .miso/ folder, such as views/home.tsx.")

export const SPACE_TOOLS: Tool[] = [
  tool({
    name: 'delete_draft_space',
    title: 'Delete one of your draft spaces',
    description: 'Deletes a draft space you made: its folder, its place in the sidebar and its tabs. Only your own drafts.',
    writes: true,
    input: { space: z.string().min(1).max(100).describe("The draft space's slug.") },
    async run(ctx, { space }) {
      const editor = await requireEditor(ctx)
      const entry = await said(() => spaceEntry(space))
      if (!isOwnDraft(entry, editor.userId)) throw new ToolRefusal('Only your own draft spaces can be deleted here.')
      const result = await said(() =>
        runChange({
          summary: `Delete the draft space ${entry.slug}`,
          author: ctx.user,
          touched: () => spaceTrackedFiles(entry.folder),
          apply: () => removeSpace(entry),
          waitForBuild: after => waitForBuild(after)
        })
      )
      if (result.status !== 'saved') return outcome(result)
      // The row last: until the build without the space is served, the app still lists it.
      const db = await vaultClient()
      const { error } = await db.rpc('delete_draft_space', { p_space: entry.id, p_user: editor.userId })
      if (error) throw new Error(`deleting the draft space's row: ${error.message}`)
      await withdrawForFolder(db, entry.folder, editor.userId)
      return { ...result, deleted: entry.slug }
    }
  }),
  tool({
    name: 'list_space_files',
    title: "List a space's files",
    description: "The files of a space's code (its .miso/ folder): views, widgets, lib and ui. Read one with read_space_file.",
    input: { space: spaceArg },
    async run(ctx, { space }) {
      return { files: await said(async () => listFiles(await seenFolder(ctx, space))) }
    }
  }),
  tool({
    name: 'read_space_file',
    title: "Read a space's file",
    description: "One file of a space's code, by its path from list_space_files.",
    input: { space: spaceArg, path: pathArg },
    async run(ctx, { space, path }) {
      return { path, content: await said(async () => readFile(await seenFolder(ctx, space), path)) }
    }
  }),
  tool({
    name: 'get_design_rules',
    title: 'Design rules for views and widgets',
    description: 'How views and widgets must look and behave in this app (docs/space-design.md). Read it before you write or change a view, widget or ui file.',
    input: {},
    async run() {
      return { rules: SPACE_DESIGN_DOC() || 'The design rules are not in this install.' }
    }
  }),
  tool({
    name: 'change_space_files',
    title: "Change a space's code",
    description:
      'Writes and deletes files of one of your spaces in one change: the app builds it, and keeps it (one commit, with your summary) only when the build passes. ' +
      "When it fails, every file goes back as it was and you get the build's errors. Send every file the change needs at once: a view and the server function it calls belong in one call. " +
      `Paths are inside the space's .miso/ folder. ${APP_NAME}'s own spaces can't be changed; make your own with create_space. ` +
      'A space may list npm packages in .miso/package.json: only "dependencies", each an exact registry version such as 1.2.3, written as JSON.stringify(value, null, 2) writes it. ' +
      "The app installs them, without install scripts, before the build. A draft's new packages are installed once an admin approves it; until then they throw when loaded. " +
      "A member who changes a space that isn't their own draft changes their own draft copy of it; send it to an admin with submit_proposal.",
    writes: true,
    input: {
      space: spaceArg,
      summary: z.string().min(1).max(200).describe('What the change does, in one line. It becomes the commit message.'),
      write: z.array(z.object({ path: pathArg, content: z.string().max(200_000) })).max(40).default([]).describe('Files to write, whole.'),
      delete: z.array(pathArg).max(40).default([]).describe('Files to delete.')
    },
    async run(ctx, args) {
      const editor = await requireEditor(ctx)
      const summary = await said(() => checkSummary(args.summary))
      if (!editor.admin) {
        // A member: their own draft, unless it waits for an admin; any other space they see goes
        // into their own draft copy of it, which they send with submit_proposal.
        const seen = await seenEntry(ctx, args.space)
        if (!isOwnDraft(seen, editor.userId)) return changeInCopy(ctx, editor, seen, summary, args)
        await said(async () => refuseIfSent(await vaultClient(), seen.folder))
      }
      const entry = await seenEntry(ctx, args.space, editor)
      const folder = entry.folder
      const change = await said(() => checkChange(folder, { write: args.write, delete: args.delete }, undefined, { draft: entry.draft === true }))
      return outcome(
        await said(() =>
          runChange({
            summary,
            author: ctx.user,
            touched: () => [...change.write.map(f => f.path), ...change.delete].map(rel => `${folder}/.miso/${rel}`),
            apply: () => applyFiles(folder, change),
            waitForBuild: after => waitForBuild(after)
          })
        )
      )
    }
  }),
  tool({
    name: 'submit_proposal',
    title: 'Send a draft to an admin',
    description:
      'Sends one of your drafts to the admins: a draft copy of a space (made by change_space_files on a space that is not yours) becomes a proposal to change that space; ' +
      'a draft space you made with create_space becomes a proposal to share it with your teams or everyone. An admin approves or rejects it in the app (Proposals). ' +
      'Until then the draft stays as it was sent; withdraw it on the Proposals page to change it again.',
    writes: true,
    input: {
      space: z.string().min(1).max(100).describe("The draft's slug."),
      summary: z.string().min(1).max(200).describe('What the proposal does, in one line. It becomes the commit message when it is approved.'),
      visibility: z.enum(['team', 'everyone']).optional().describe('Only for a draft space of your own: who sees it once it is approved. team: your teams.')
    },
    async run(ctx, { space, summary, visibility }) {
      const editor = await requireEditor(ctx)
      const entry = await seenEntry(ctx, space)
      const line = await said(() => checkSummary(summary))
      const sent = await said(async () =>
        submitProposal({ db: await vaultClient() }, { entry, userId: editor.userId, author: ctx.user, summary: line, ...(visibility ? { visibility } : {}) })
      )
      return { status: 'sent', proposal: sent.id, kind: sent.kind, next: 'An admin approves or rejects it on the Proposals page of the app. You see the decision there.' }
    }
  }),
  tool({
    name: 'create_space',
    title: 'Create a space',
    description:
      'Makes a new, empty space of yours: its folder with the name and the UI kit (.miso/ui/kit.tsx) every space starts from, and its place in the sidebar. ' +
      'Then add views and widgets with change_space_files, and tabs with edit_tabs. A member makes a draft: only they see it, its views and widgets work at once, ' +
      'and its server functions run once an admin has approved it. A member has at most 3 drafts.',
    writes: true,
    input: {
      name: z.string().min(1).max(60).describe("The space's name, as the sidebar shows it."),
      slug: z.string().max(40).optional().describe('Its address, lowercase letters, digits and dashes. Made from the name when left out.')
    },
    async run(ctx, { name, slug }) {
      const editor = await requireEditor(ctx)
      const draftBy = editor.admin ? undefined : editor.userId
      // Every space there is, with or without code, through the vault account: ids are never reused.
      const { data, error } = await (await vaultClient()).from('spaces').select('id, slug, previous_slugs')
      if (error) throw new Error(`reading spaces: ${error.message}`)
      const rows = (data ?? []) as { id: string; slug: string; previous_slugs: string[] | null }[]
      const taken = { ids: new Set(rows.map(r => r.id)), slugs: new Set(rows.flatMap(r => [r.slug, ...(r.previous_slugs ?? [])])) }
      // Planned inside the lock, so two calls with the same name can't both take the slug.
      let space: NewSpace | null = null
      const result = await said(() =>
        runChange({
          summary: `Create the ${draftBy ? 'draft ' : ''}space ${name.trim()}`,
          author: ctx.user,
          prepare: () => {
            if (draftBy) checkDraftCap(draftBy)
            space = planSpace(name, slug, taken)
          },
          touched: () => spaceFiles(space!),
          apply: () => writeSpace(space!, undefined, draftBy),
          waitForBuild: after => waitForBuild(after)
        })
      )
      const made = space as NewSpace | null
      return result.status === 'saved' && made ? { ...result, space: { slug: made.slug, name: made.name, ...(draftBy ? { draft: true } : {}) } } : outcome(result)
    }
  }),
  tool({
    name: 'edit_tabs',
    title: "Set a space's tabs",
    description:
      "Sets a space's tabs to exactly this list, in this order: 'widgets' for the widget grid, or 'view:<folder>/<view>' for a view (get_space lists them). " +
      'Tabs not in the list are closed.',
    writes: true,
    input: { space: spaceArg, tabs: z.array(z.string().min(1).max(200)).max(50).describe('The tab refs in order.') },
    async run(ctx, { space, tabs }) {
      const editor = await requireEditor(ctx)
      const own = editor.admin ? undefined : await seenEntry(ctx, space, editor)
      if (new Set(tabs).size !== tabs.length) throw new ToolRefusal('Name each tab once.')
      // Every ref first, so a bad one changes nothing.
      const hidden = (await ctx.hidden()).viewRefs
      const views = new Set(ctx.catalog.applets.filter(a => a.kind === 'view' && !hidden.has(a.ref)).map(a => `view:${a.ref}`))
      const unknown = tabs.filter(ref => ref !== 'widgets' && !views.has(ref))
      if (unknown.length) throw new ToolRefusal(`No such view in this build: ${unknown.join(', ')}. get_space lists the views; a new view shows up once its change is saved.`)
      const call = api(ctx)
      const { id, workspace } = await spaceId(ctx, space, own?.id)
      const current = workspace.tabs.filter(t => t.spaceId === id)
      for (const t of current) if (!tabs.includes(t.ref)) await call('DELETE', `/api/tabs/${encodeURIComponent(t.id)}`)
      const ids: string[] = []
      for (const ref of tabs) {
        const made = (await call('POST', `/api/spaces/${encodeURIComponent(id)}/tabs`, { ref })) as { id: string }
        ids.push(made.id)
      }
      await call('PUT', `/api/spaces/${encodeURIComponent(id)}/tabs/order`, { ids })
      return { space, tabs }
    }
  }),
  tool({
    name: 'edit_layout',
    title: "Set a space's widget grid",
    description: "Sets the widgets on a space's grid: each a widget ref ('<folder>/<widget>') with its cell (x, y) and size (w, h) on a 12-column grid.",
    writes: true,
    input: {
      space: spaceArg,
      widgets: z
        .array(z.object({ ref: z.string().min(1).max(200), x: z.number().int().min(0).max(100), y: z.number().int().min(0).max(1000), w: z.number().int().min(1).max(12), h: z.number().int().min(1).max(50) }))
        .max(50)
    },
    async run(ctx, { space, widgets }) {
      const editor = await requireEditor(ctx)
      const own = editor.admin ? undefined : await seenEntry(ctx, space, editor)
      const { id } = await spaceId(ctx, space, own?.id)
      await api(ctx)('PUT', `/api/spaces/${encodeURIComponent(id)}/layout`, { widgets })
      return { space, widgets: widgets.length }
    }
  })
]

type FileArgs = { write: { path: string; content: string }[]; delete: string[] }

/**
 * A member's change to a space that isn't their own draft: into their draft copy of it, made from
 * the space's last commit in the same change when they have none yet (one build, one commit).
 */
async function changeInCopy(ctx: ToolContext, editor: Editor, live: SpaceEntry, summary: string, args: FileArgs): Promise<unknown> {
  if (shippedFolders().includes(live.folder)) {
    throw new ToolRefusal(`${live.folder} is one of ${APP_NAME}'s own spaces: every start puts it back as ${APP_NAME} ships it, so it can't be changed here. Make your own space with create_space.`)
  }
  if (live.draft) throw new ToolRefusal('Only your own drafts can be changed. Make your own space with create_space.')
  const copy = findCopy(live.folder, editor.userId)
  const db = await vaultClient()
  if (copy) await said(() => refuseIfSent(db, copy.folder))
  // A new copy holds what the live space holds, so the change is checked against the live folder.
  const change = await said(() => checkChange(copy?.folder ?? live.folder, { write: args.write, delete: args.delete }, undefined, { draft: true }))
  let made: { folder: string; id: string; slug: string } | null = copy ?? null
  let fresh = false
  const result = await said(() =>
    runChange({
      summary,
      author: ctx.user,
      prepare: () => {
        if (copy) return
        // Again inside the lock: a change that ran meanwhile may have made the copy.
        const meanwhile = findCopy(live.folder, editor.userId)
        if (meanwhile) throw new FileRefusal(`Your draft copy of ${live.slug} was made a moment ago by another change. Send this change again.`)
        checkDraftCap(editor.userId)
        made = planCopy(live)
        fresh = true
      },
      touched: () => copyChangeFiles(live, made!.folder, change, fresh),
      apply: () => {
        if (fresh) writeCopy(live, made!, editor.userId)
        applyFiles(made!.folder, change)
      },
      waitForBuild: after => waitForBuild(after)
    })
  )
  if (result.status === 'put back' || !made) return outcome(result)
  const target = made as { slug: string }
  return {
    ...result,
    draft: target.slug,
    next:
      `The change is in your own draft copy of ${live.slug} (address /${target.slug}), not in ${live.slug} itself: only you see it. ` +
      'Change it further by naming either space; when it is ready, send it to an admin with submit_proposal.'
  }
}

// --- The design rules, from the files in the image, read once (no second copy of the text) ---

let doc: string | null = null
let rules: string | null = null
const readText = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : '')

/** docs/space-design.md, or '' when this install doesn't have it. */
export function SPACE_DESIGN_DOC(): string {
  return (doc ??= readText(join(APP_ROOT, 'docs', 'space-design.md')))
}

/** The "Design of views and widgets" section of AGENTS.md, for the server's instructions; '' when missing. */
export function DESIGN_RULES(): string {
  if (rules === null) {
    const text = readText(join(APP_ROOT, 'AGENTS.md'))
    const start = text.indexOf('## Design of views and widgets')
    const end = start < 0 ? -1 : text.indexOf('\n## ', start + 3)
    rules = start < 0 ? '' : text.slice(start, end < 0 ? undefined : end).trim()
  }
  return rules
}
