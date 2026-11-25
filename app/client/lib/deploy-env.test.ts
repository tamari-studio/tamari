import { expect, test } from 'bun:test'

import { previewBannerText } from './deploy-env'

test('a preview deployment warns that it writes to real data', () => {
  expect(previewBannerText('preview')).toBe(
    'This is a preview. It uses the real data, so anything you change here is saved for everyone.'
  )
})

test('production, local builds and unknown values show no banner', () => {
  expect(previewBannerText('production')).toBeNull()
  expect(previewBannerText('local')).toBeNull()
  expect(previewBannerText(undefined)).toBeNull()
})
