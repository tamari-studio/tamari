// Reads a vault, a git repo of Markdown notes plus `.claude/skills`, through the GitHub API.
// The repo comes from a Custom connector: VAULT_REPO ("owner/name"), VAULT_TOKEN (read access to
// Contents; read and write to Contents and Pull requests for proposals), and optionally VAULT_REF
// (a branch; default HEAD). Notes are read and proposed in notes.server.ts, and proposals (pull
// requests) are listed in proposals.server.ts.
import { requireCaller } from '@miso/caller'
import { github, vaultCache, vaultConfig } from './github'
import { encodePath, isNotePath } from './paths'
import { parseSkillMd, type SkillMeta } from './skills'

export type VaultData =
  | { configured: false }
  | { configured: true; repo: string; ref: string; skills: SkillMeta[]; notes: string[]; truncated: boolean }

const SKILL = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/

export async function getVault(): Promise<VaultData> {
  requireCaller()
  const config = vaultConfig()
  if (!config) return { configured: false }
  const { repo, ref } = config

  const key = `${repo}@${ref}`
  const hit = vaultCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.data as VaultData

  const tree = (await (await github(config, `git/trees/${encodeURIComponent(ref)}?recursive=1`)).json()) as {
    tree: { path: string; type: string }[]
    truncated: boolean
  }
  const files = tree.tree.filter(e => e.type === 'blob').map(e => e.path)
  // Dot folders (.claude, .obsidian…) and node_modules are tooling, not notes.
  const notes = files.filter(isNotePath)

  const skillPaths = files.filter(p => SKILL.test(p))
  const skills = await Promise.all(
    skillPaths.map(async (p): Promise<SkillMeta> => {
      const id = SKILL.exec(p)![1]
      const text = await (await github(config, `contents/${encodePath(p)}?ref=${encodeURIComponent(ref)}`, true)).text()
      return { id, ...parseSkillMd(text, id) }
    })
  )
  skills.sort((a, b) => a.id.localeCompare(b.id))

  const data: VaultData = { configured: true, repo, ref, skills, notes, truncated: tree.truncated }
  vaultCache.set(key, { at: Date.now(), data })
  return data
}
