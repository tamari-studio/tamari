// Departments and who is in them (miso.departments, miso.department_members,
// migration 20261110000000_departments). Admins and owners keep them on the People &
// access page; its Spaces tab lets a department see a space.
//
// Row level security lets everyone who can use the app read them and
// only admins and owners change them; app.ts checks the tier first so the page
// can explain a refusal.
import type { Department } from '../lib/types'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import type { Db } from './supabase'

export type DepartmentsStore = {
  list(): Promise<Department[]>
  create(name: string): Promise<Department>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
  addMember(id: string, userId: string): Promise<void>
  removeMember(id: string, userId: string): Promise<void>
}

// A request body's `name`, trimmed.
export function parseDepartmentName(body: unknown): string {
  const name = typeof body === 'object' && body !== null && 'name' in body ? (body as { name: unknown }).name : undefined
  if (typeof name !== 'string' || !name.trim()) throw new InputError('Give the department a name.')
  if (name.trim().length > 80) throw new InputError('A department name is at most 80 characters.')
  return name.trim()
}

type Failure = { code?: string; message: string }

function refuse(error: Failure): never {
  if (error.code === '23505') throw new InputError('There is already a department with that name.')
  if (error.code === '23514') throw new InputError('A department name is 1 to 80 characters.')
  if (error.code === '23503' || error.code === '22P02') throw new InputError('There is no such department or person.')
  if (error.code === '42501') throw new ForbiddenError('Only admins and owners can change departments.')
  if (error.code === '42P01' || error.code === 'PGRST205') throw new Error('Departments need migration 20261110000000_departments in the database.')
  throw new Error(error.message)
}

export function supabaseDepartmentsStore(client: Db): DepartmentsStore {
  return {
    async list() {
      const [departments, members] = await Promise.all([
        client.from('departments').select('id, name').order('name'),
        client.from('department_members').select('department_id, user_id')
      ])
      if (departments.error) refuse(departments.error)
      if (members.error) refuse(members.error)
      const rows = (members.data ?? []) as { department_id: string; user_id: string }[]
      return ((departments.data ?? []) as { id: string; name: string }[]).map(d => ({
        ...d,
        memberIds: rows.filter(r => r.department_id === d.id).map(r => r.user_id)
      }))
    },
    async create(name) {
      const { data, error } = await client.from('departments').insert({ name }).select('id, name').single<{ id: string; name: string }>()
      if (error) refuse(error)
      return { ...data, memberIds: [] }
    },
    async rename(id, name) {
      const { data, error } = await client.from('departments').update({ name }).eq('id', id).select('id')
      if (error) refuse(error)
      // Row level security answers a refused update with zero rows, not an error.
      if (!data?.length) throw new InputError('There is no such department.')
    },
    async remove(id) {
      const { error } = await client.from('departments').delete().eq('id', id)
      if (error) refuse(error)
    },
    async addMember(id, userId) {
      const { error } = await client
        .from('department_members')
        .upsert({ department_id: id, user_id: userId }, { onConflict: 'department_id,user_id', ignoreDuplicates: true })
      if (error) refuse(error)
    },
    async removeMember(id, userId) {
      const { error } = await client.from('department_members').delete().eq('department_id', id).eq('user_id', userId)
      if (error) refuse(error)
    }
  }
}
