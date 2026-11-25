import { expect, test } from 'bun:test'

import { designProblems } from './space-design'

test('another icon pack in a view is a problem, Tabler is not', () => {
  expect(designProblems('acme/.miso/views/home.tsx', "import { Home } from 'lucide-react'")).toHaveLength(1)
  expect(designProblems('acme/.miso/views/home.tsx', "import { IconHome } from '@tabler/icons-react'")).toEqual([])
})

test('a scrolling widget is a problem; a scrolling view, a _helper and a lib file are not', () => {
  const scroll = '<div className="h-full overflow-y-auto">'
  expect(designProblems('acme/.miso/widgets/latest.tsx', scroll)).toHaveLength(1)
  expect(designProblems('acme/.miso/views/list.tsx', scroll)).toEqual([])
  expect(designProblems('acme/.miso/widgets/_row.tsx', scroll)).toEqual([])
  expect(designProblems('acme/.miso/lib/rows.ts', "import x from 'lucide-react'")).toEqual([])
})
