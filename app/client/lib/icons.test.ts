import { IconFolder, IconRocket, IconSoup } from '@tabler/icons-react'
import { expect, test } from 'bun:test'

import { spaceIcon } from './icons'

test('a space shows its picked symbol, else its folder icon, else a folder', () => {
  expect(spaceIcon({ folder: 'miso', symbol: 'rocket' })).toBe(IconRocket)
  expect(spaceIcon({ folder: 'miso', symbol: null })).toBe(IconSoup)
  expect(spaceIcon({ folder: null, symbol: 'gone' })).toBe(IconFolder)
  expect(spaceIcon({ folder: null, symbol: 'constructor' })).toBe(IconFolder)
})
