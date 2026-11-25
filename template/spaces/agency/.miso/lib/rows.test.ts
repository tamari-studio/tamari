import { expect, spyOn, test } from 'bun:test'

import { fields, text } from './check'
import { EXAMPLE, MAX_ROWS, memoryStore, rows } from './rows'

type Note = { title: string }
const parse = (input: unknown): Note => ({ title: text(fields(input).title, 'Title', { required: true, max: 20 }) })
const examples = (today: string): Note[] => [{ title: `First ${today}` }, { title: 'Second' }]
const setup = () => {
  const store = memoryStore<Note>()
  return { store, list: rows(store, { parse, examples }) }
}

test('save adds a row with a new key, and saves it again under the same key', async () => {
  const { store, list } = setup()
  const added = await list.save({ title: '  Call back ' })
  expect(added).toMatchObject({ title: 'Call back', example: false })
  expect(added.key).toMatch(/^r-[0-9a-f-]{36}$/)
  await list.save({ key: added.key, title: 'Called' })
  expect(await list.list()).toEqual([{ key: added.key, title: 'Called', example: false }])
  expect(store.data.size).toBe(1)
})

test('save checks the row and the key before it writes', async () => {
  const { store, list } = setup()
  await expect(list.save({ title: '' })).rejects.toThrow('Title is needed.')
  await expect(list.save({ key: '../other', title: 'x' })).rejects.toThrow('could not be found')
  await expect(list.save('nope')).rejects.toThrow('could not be read')
  expect(store.data.size).toBe(0)
})

test('only what the check returns is saved, never extra fields from the browser', async () => {
  const { store, list } = setup()
  const added = await list.save({ title: 'Plan', admin: true, example: true })
  expect(store.data.get(added.key)).toEqual({ title: 'Plan' })
})

test('a row that does not pass the check is left out of the list', async () => {
  const { store, list } = setup()
  store.data.set('r-good', { title: 'Good' })
  store.data.set('r-bad', { nope: 1 } as unknown as Note)
  expect((await list.list()).map(r => r.key)).toEqual(['r-good'])
})

test('examples load once, are marked, and go away together, also when edited', async () => {
  const { store, list } = setup()
  const own = await list.save({ title: 'Mine' })
  expect(await list.loadExamples('2026-03-04')).toBe(2)
  expect(await list.loadExamples('2026-03-04')).toBe(2)
  expect(store.data.size).toBe(3)
  await list.save({ key: `${EXAMPLE}1`, title: 'Edited' })
  expect((await list.list()).filter(r => r.example).map(r => r.title)).toEqual(['Edited', 'Second'])
  expect(await list.removeExamples()).toBe(2)
  expect((await list.list()).map(r => r.key)).toEqual([own.key])
})

test('remove takes a checked key', async () => {
  const { store, list } = setup()
  const added = await list.save({ title: 'Gone soon' })
  await expect(list.remove({ key: added.key })).rejects.toThrow('could not be found')
  await list.remove(added.key)
  expect(store.data.size).toBe(0)
})

test('a full list refuses new rows but still saves existing ones', async () => {
  const { store, list } = setup()
  for (let i = 0; i < MAX_ROWS; i++) store.data.set(`r-${i}`, { title: 'x' })
  await expect(list.save({ title: 'One more' })).rejects.toThrow('This list is full')
  expect((await list.save({ key: 'r-1', title: 'Changed' })).title).toBe('Changed')
})

test('update changes one saved row and checks the result', async () => {
  const { store, list } = setup()
  const added = await list.save({ title: 'Draft' })
  expect(await list.update(added.key, row => ({ ...row, title: `${row.title} 2` }))).toEqual({ key: added.key, title: 'Draft 2', example: false })
  expect(store.data.get(added.key)).toEqual({ title: 'Draft 2' })
  await expect(list.update(added.key, () => ({ title: '' }))).rejects.toThrow('Title is needed.')
  await expect(list.update('r-nobody', row => row)).rejects.toThrow('That row is gone')
  await expect(list.update('../x', row => row)).rejects.toThrow('could not be found')
})

test('unique refuses a second row about the same thing, but lets a row be saved again', async () => {
  const store = memoryStore<Note>()
  const list = rows(store, { parse, examples, unique: { of: row => row.title.toLowerCase(), taken: row => `There is already a row called ${row.title}.` } })
  const first = await list.save({ title: 'March' })
  await expect(list.save({ title: 'march' })).rejects.toThrow('There is already a row called march.')
  expect((await list.save({ key: first.key, title: 'March' })).key).toBe(first.key)
  const second = await list.save({ title: 'April' })
  await expect(list.save({ key: second.key, title: 'March' })).rejects.toThrow('already a row')
  expect(store.data.size).toBe(2)
})

test('a store error is logged and the person gets a plain sentence', async () => {
  const { store, list } = setup()
  store.put = async () => {
    throw new Error('[@miso/store] put notes/r-1: permission denied for table records')
  }
  const logged = spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(list.save({ title: 'x' })).rejects.toThrow('Could not save that. Try again; if it keeps happening, tell an admin.')
    expect(logged).toHaveBeenCalledTimes(1)
  } finally {
    logged.mockRestore()
  }
})
