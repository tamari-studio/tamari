// The welcome step: on first sign-in a person enters their name and position and picks their
// department(s), which decides the spaces they see (app/lib/access.ts). An admin or owner may type a
// new department instead (only they may make one), and the first owner then picks sample spaces
// (server/samples.ts).
//
// The name goes on their sign-in account (Supabase Auth user metadata, where /api/me's name comes
// from), which works today. miso.welcome_self (migration 20261110000100_department_self_join) copies it
// to their member row and puts them in the departments, once: only while they are in none. Until it
// is applied the name is still saved and an admin places them.
import type { Department, Me, SpaceAccessRule, WelcomeDepartment, WelcomeInput } from '../lib/types'
import { hasAtLeast } from '../vendor/dto-core/tier'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import { publishableKey, supabaseUrl, type Db } from './supabase'

export const NAME_MAX = 80
export const POSITION_MAX = 80
export const DEPARTMENTS_MAX = 20

export type WelcomeStore = {
  // Whether this account finished the welcome step or was ever in a department
  // (app.app_user.welcomed_at, migration 20261116000100_welcome_once). After that only an admin
  // changes their departments.
  welcomed(): Promise<boolean>
  saveName(name: string): Promise<void>
  // Whether the database has app.app_user.position (migration 20261125000000_member_position): the
  // welcome step asks for a position only then, so nothing typed is lost.
  hasPosition(): Promise<boolean>
  savePosition(position: string): Promise<void>
  // Whether they were put in the departments; 'missing' while the database has no welcome_self.
  join(name: string, departmentIds: string[]): Promise<boolean | 'missing'>
}

// Departments someone may put themself in: not one that a rule leaving admins out names. An admin
// can't put anyone in those (the departments migration), so a member can't join them either (welcome_self says the same).
export function selectableDepartments(departments: readonly Department[], rules: readonly SpaceAccessRule[]): WelcomeDepartment[] {
  const closed = new Set(rules.filter(r => !r.tiers.includes('admin')).flatMap(r => r.departments ?? []))
  return departments.filter(d => !closed.has(d.id)).map(({ id, name }) => ({ id, name }))
}

// First sign-in, from data: an active account that was never welcomed nor in a department. Admins
// and owners too: the migration marked every account there was as welcomed, so it is a new one.
export function needsWelcome(user: Pick<Me, 'id' | 'tier' | 'status'>, departments: readonly Department[], welcomed = false): boolean {
  if (user.status !== 'active' || user.tier === null || welcomed) return false
  return !departments.some(d => d.memberIds.includes(user.id))
}

// Only admins and owners may make a department (row level security on miso.departments).
export const mayMakeTeam = (user: Pick<Me, 'tier' | 'status'>): boolean => hasAtLeast(user.tier, user.status, 'admin')

const oneLine = (value: unknown, what: string, max: number): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new InputError(`${what} is at most ${max} characters, on one line.`)
  return value.trim() || undefined
}

export function parseWelcome(body: unknown, selectable: ReadonlySet<string>): WelcomeInput {
  const { name, departmentIds = [], position, newTeam } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (typeof name !== 'string' || !name.trim()) throw new InputError('Enter your name.')
  // Control characters have no place in a name shown to everyone.
  if (name.trim().length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) throw new InputError(`A name is at most ${NAME_MAX} characters, on one line.`)
  if (!Array.isArray(departmentIds) || departmentIds.some(id => typeof id !== 'string')) throw new InputError('Pick departments from the list.')
  const ids = [...new Set(departmentIds as string[])]
  if (ids.length > DEPARTMENTS_MAX) throw new InputError(`Pick at most ${DEPARTMENTS_MAX} departments.`)
  if (ids.some(id => !selectable.has(id))) throw new InputError("One of those departments isn't on the list any more. Reload and pick again.")
  const pos = oneLine(position, 'A position', POSITION_MAX)
  const team = oneLine(newTeam, 'A team name', NAME_MAX)
  return { name: name.trim(), departmentIds: ids, ...(pos ? { position: pos } : {}), ...(team ? { newTeam: team } : {}) }
}

// Read once per server: a migration lands with a restart (Compose applies them at start, a deploy
// starts new instances).
let positionColumn: boolean | undefined

export function supabaseWelcomeStore(client: Db, token: string, userId: string): WelcomeStore {
  return {
    async hasPosition() {
      if (positionColumn !== undefined) return positionColumn
      const { error } = await client.schema('app').from('app_user').select('position').eq('user_id', userId).maybeSingle()
      if (error && error.code !== '42703') throw new Error(`reading position: ${error.message}`)
      return (positionColumn = !error)
    },
    async welcomed() {
      const { data, error } = await client
        .schema('app')
        .from('app_user')
        .select('welcomed_at')
        .eq('user_id', userId)
        .maybeSingle<{ welcomed_at: string | null }>()
      // A database without the column yet (42703): nobody counts as welcomed, as before it.
      if (error?.code === '42703') return false
      if (error) throw new Error(`reading welcomed_at: ${error.message}`)
      return data?.welcomed_at != null
    },
    async saveName(name) {
      // As the person themself: Auth lets everyone change their own metadata. A key of our own,
      // because Google signs in over full_name and name every time.
      const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
        method: 'PUT',
        headers: { apikey: publishableKey(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { display_name: name } })
      })
      if (!res.ok) {
        console.error(`saving a name: Auth answered ${res.status}`)
        throw new Error("Couldn't save your name. Try again in a moment.")
      }
    },
    async savePosition(position) {
      const { error } = await client.rpc('set_own_position', { p_position: position })
      if (!error) return
      // The column came without the function (a half-applied database): the welcome still finishes.
      if (error.code === 'PGRST202' || error.code === '42883') return void console.warn('saving a position: miso.set_own_position is missing; the position was not saved')
      if (error.code === '22023') throw new InputError(`A position is at most ${POSITION_MAX} characters, on one line.`)
      console.error(`saving a position: ${error.message}`)
      throw new Error("Couldn't save your position. Try again in a moment.")
    },
    async join(name, departmentIds) {
      const { data, error } = await client.rpc('welcome_self', { p_name: name, p_departments: departmentIds })
      if (!error) return data === true
      if (error.code === 'PGRST202' || error.code === '42883') return 'missing'
      if (error.code === '42501') throw new ForbiddenError("You can't join one of those departments. Ask an admin to add you.")
      if (error.code === '23503' || error.code === '22023' || error.code === '22P02') {
        throw new InputError("One of those departments isn't on the list any more. Reload and pick again.")
      }
      console.error(`joining departments: ${error.message}`)
      throw new Error("Couldn't add you to your department. Try again in a moment.")
    }
  }
}
