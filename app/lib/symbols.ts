// The icon ids a space can carry (miso.spaces.symbol, picked on Settings → Organisation). The
// server accepts only these; app/client/lib/icons.tsx draws each one.
export const SYMBOLS = [
  'activity', 'atom', 'bell', 'book', 'briefcase', 'building', 'bulb', 'calendar', 'chart',
  'cloud', 'code', 'coin', 'compass', 'database', 'factory', 'file', 'flag', 'flask', 'folder',
  'heart', 'home', 'leaf', 'mail', 'map', 'message', 'palette', 'puzzle', 'rocket', 'settings',
  'soup', 'sparkles', 'star', 'target', 'tool', 'trophy', 'truck', 'user', 'users', 'vault',
  'world'
] as const

export type SymbolId = (typeof SYMBOLS)[number]

export const isSymbol = (value: unknown): value is SymbolId => SYMBOLS.includes(value as SymbolId)
