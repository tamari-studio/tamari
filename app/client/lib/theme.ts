// The app's theme (font, color, radius), one for the whole organisation (Settings → Organisation):
// the same presets as miso's lib/themes.ts, applied as CSS variables on <html>.
import type { SpaceTheme } from '../../lib/types'

const FONTS: Record<string, { sans: string; mono: string; query?: string }> = {
  sans: { sans: 'system-ui', mono: 'Geist Mono', query: 'Geist+Mono:wght@400;500' },
  serif: { sans: 'Literata', mono: 'Geist Mono', query: 'Literata:wght@400;600;700&family=Geist+Mono:wght@400;500' },
  mono: { sans: 'Geist Mono', mono: 'Geist Mono', query: 'Geist+Mono:wght@400;500;600' },
  geometric: { sans: 'Manrope', mono: 'Geist Mono', query: 'Manrope:wght@400;500;600&family=Geist+Mono:wght@400;500' },
  rounded: { sans: 'SN Pro', mono: 'Geist Mono', query: 'SN+Pro:wght@400;500;600&family=Geist+Mono:wght@400;500' },
  blobby: { sans: 'Sour Gummy', mono: 'Azeret Mono', query: 'Sour+Gummy:wght@400;500;600&family=Azeret+Mono:wght@400;500' },
  awkward: {
    sans: 'Averia Sans Libre',
    mono: 'Azeret Mono',
    query: 'Averia+Sans+Libre:wght@400;500;600&family=Azeret+Mono:wght@400;500'
  },
  comic: { sans: 'Comic Sans MS, Comic Sans, cursive', mono: 'Geist Mono', query: 'Geist+Mono:wght@400;500' }
}

const RADII: Record<string, string> = { squishy: '0.875rem', soft: '0.625rem', subtle: '0.375rem', square: '0' }

// Each preset's primary and the text that reads on it: black when the primary's WCAG luminance is
// above 0.3, else white. Fixed here so culori stays out of the bundle; theme.test.ts checks them.
const BLACK = 'oklch(0 0 0)'
const WHITE = 'oklch(1 0 0)'
export const COLOR_PRESETS: Record<string, { primary: string; foreground: string } | undefined> = {
  default: undefined,
  paper: { primary: 'oklch(0.4328 0.0351 66.67)', foreground: WHITE },
  rose: { primary: 'oklch(0.6322 0.2171 26.02)', foreground: WHITE },
  tangerine: { primary: 'oklch(0.6886 0.22 37.15)', foreground: WHITE },
  sand: { primary: 'oklch(0.8334 0.1271 67.80)', foreground: BLACK },
  mint: { primary: 'oklch(0.5774 0.1399 156.06)', foreground: WHITE },
  sky: { primary: 'oklch(0.5824 0.1830 253.59)', foreground: WHITE },
  lavender: { primary: 'oklch(0.6025 0.2426 294.58)', foreground: WHITE }
}

function colorVars({ primary, foreground }: { primary: string; foreground: string }): Record<string, string> {
  return {
    '--primary': primary,
    '--primary-foreground': foreground,
    '--background': 'color-mix(in srgb, var(--primary) 2%, oklch(1 0 0) 98%)',
    '--foreground': 'color-mix(in srgb, var(--primary) 20%, oklch(0 0 0) 80%)',
    '--muted': 'color-mix(in srgb, var(--background) 95%, var(--foreground) 5%)',
    '--muted-foreground': 'color-mix(in srgb, var(--background) 50%, var(--foreground) 50%)',
    '--accent': 'color-mix(in srgb, var(--primary) 3%, var(--foreground) 4%)',
    '--accent-foreground': 'var(--foreground)',
    '--border': 'color-mix(in srgb, var(--foreground) 7%, transparent)',
    '--ring': 'color-mix(in srgb, var(--background) 50%, var(--primary) 50%)',
    // The soft lift under shadow-md and up (theme.css): the preset's colour, not Tamari's periwinkle.
    '--lift': 'color-mix(in srgb, var(--primary) 55%, oklch(0 0 0))'
  }
}

const loadedFonts = new Set<string>()
let applied: string[] = []

function loadFont(query: string): void {
  if (loadedFonts.has(query)) return
  loadedFonts.add(query)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`
  document.head.appendChild(link)
}

// Tamari's brand faces (--display, --wordmark in base.css), the same as the Tamari site. Loaded from
// script, like the theme fonts, so an install that can't reach Google Fonts still paints at once.
export const BRAND_FONT_QUERY = 'M+PLUS+1:wght@500;600&family=Zen+Kaku+Gothic+New:wght@400;500'
export function loadBrandFonts(): void {
  loadFont(BRAND_FONT_QUERY)
}

// The CSS variables a theme sets on <html>, and the Google Fonts query its font needs.
export function themeVars(theme: SpaceTheme | undefined): { vars: Record<string, string>; fontQuery?: string } {
  const vars: Record<string, string> = {}
  const fontKey = theme?.font ?? 'sans'
  const font = FONTS[fontKey] ?? FONTS.sans
  vars['--sans'] = `${font.sans}, var(--default-sans)`
  vars['--mono'] = `'${font.mono}', var(--default-mono)`
  // A font an organisation picked rules the wordmark and titles too; only the default uses Tamari's faces.
  if (FONTS[fontKey] && fontKey !== 'sans') {
    vars['--display'] = 'var(--sans)'
    vars['--wordmark'] = 'var(--sans)'
  }

  vars['--radius'] = RADII[theme?.radius ?? 'soft'] ?? RADII.soft
  const preset = COLOR_PRESETS[theme?.color ?? 'default']
  if (preset) Object.assign(vars, colorVars(preset))
  return { vars, fontQuery: font.query }
}

export function applyTheme(theme: SpaceTheme | undefined): void {
  const root = document.documentElement
  for (const key of applied) root.style.removeProperty(key)
  const { vars, fontQuery } = themeVars(theme)
  if (fontQuery) loadFont(fontQuery)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  applied = Object.keys(vars)
}

export const THEME_OPTIONS = {
  font: Object.keys(FONTS),
  color: Object.keys(COLOR_PRESETS),
  radius: Object.keys(RADII)
}
