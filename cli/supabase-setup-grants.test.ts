import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// scripts/supabase-setup.ts repairs a service account through the secret key (service_role): it
// deletes the account's app.app_user row and writes miso.members. Without these grants a setup that
// was cut off halfway can't be finished ("permission denied for schema app").
const dir = join(import.meta.dir, '..', 'supabase', 'migrations')
const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(dir, f), 'utf8')).join('\n').toLowerCase().replace(/\s+/g, ' ')
const granted = (privileges: string, on: string) => new RegExp(`grant [a-z, ]*\\b${privileges}\\b[a-z, ]* on ${on.replace('.', '\\.')} to service_role`).test(sql)

test('the setup script uses app.app_user and miso.members', () => {
  const script = readFileSync(join(import.meta.dir, '..', 'scripts', 'supabase-setup.ts'), 'utf8')
  expect(script).toContain(`c.app.from('app_user').delete()`)
  expect(script).toContain(`c.miso.from('members').upsert(`)
})

test('the migrations give service_role what the setup repair needs', () => {
  expect(sql).toContain('grant usage on schema app to service_role')
  expect(sql).toContain('grant usage on schema miso to service_role')
  expect(granted('select', 'app.app_user')).toBe(true)
  expect(granted('delete', 'app.app_user')).toBe(true)
  for (const p of ['select', 'insert', 'update']) expect(granted(p, 'miso.members')).toBe(true)
})
