import { expect, test } from 'bun:test'
import { wcagContrast, wcagLuminance } from 'culori'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLOR_PRESETS, themeVars } from './theme'

test('each color preset keeps the foreground its luminance calls for', () => {
  for (const preset of Object.values(COLOR_PRESETS)) {
    if (!preset) continue
    expect(preset.foreground).toBe(wcagLuminance(preset.primary) > 0.3 ? 'oklch(0 0 0)' : 'oklch(1 0 0)')
  }
})

test('the default theme keeps Tamari’s brand faces; a picked font replaces them', () => {
  for (const theme of [undefined, { font: 'sans' }]) {
    const { vars } = themeVars(theme)
    expect(vars['--display']).toBeUndefined()
    expect(vars['--wordmark']).toBeUndefined()
  }
  const { vars } = themeVars({ font: 'serif' })
  expect(vars['--display']).toBe('var(--sans)')
  expect(vars['--wordmark']).toBe('var(--sans)')
  expect(vars['--sans']).toContain('Literata')
})

test('a colour preset sets the shadows’ lift; the default leaves Tamari’s periwinkle', () => {
  expect(themeVars(undefined).vars['--lift']).toBeUndefined()
  expect(themeVars({ color: 'rose' }).vars['--lift']).toContain('var(--primary)')
})

test('default muted text passes WCAG AA on white and on the muted chrome', () => {
  const css = readFileSync(join(import.meta.dir, '..', 'base.css'), 'utf8')
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
  const token = (name: string) => root.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))![1]
  expect(wcagContrast(token('muted-foreground'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  expect(wcagContrast(token('muted-foreground'), token('muted'))).toBeGreaterThanOrEqual(4.5)
})
