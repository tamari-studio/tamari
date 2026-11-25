// The product's name, in one place (shell UI, server messages, the page title), so a rename is one edit.
// WORDMARK is how the name is drawn as a logo (sidebar, sign-in, the browser tab).
export const APP_NAME = 'Tamari'
export const WORDMARK = 'Tamari'

// The Tamari mark (three stacked forms) on a 24×24 grid, drawn in one colour.
export const MARK_PATHS = [
  'M12.2 1.5H18a3 3 0 0 1 0 6h-8a1 1 0 0 1-1-1V4.7a3.2 3.2 0 0 1 3.2-3.2z',
  'M6 9h10a1 1 0 0 1 1 1v1.8a3.2 3.2 0 0 1-3.2 3.2H6a3 3 0 0 1 0-6z',
  'M10 16.5h8.8a3.2 3.2 0 0 1 3.2 3.2v1.8a1 1 0 0 1-1 1H10a3 3 0 0 1 0-6z'
]

// The browser tab icon: the mark, dark on a light tab bar and white on a dark one.
export const FAVICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><style>path{fill:#0f1220}@media (prefers-color-scheme:dark){path{fill:#fff}}</style>${MARK_PATHS.map(d => `<path d="${d}"/>`).join('')}</svg>`
)}`
