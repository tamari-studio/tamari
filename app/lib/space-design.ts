// The design rules a machine can check (docs/space-design.md): run over the shipped spaces by
// cli/space-design.test.ts, and on every file the MCP write tools take (server/space-files.ts).
// `path` is a space file's path; only .tsx files under .miso/views, widgets and ui are checked.

const OTHER_ICONS = /from ['"](lucide-react|react-icons[^'"]*|@heroicons\/[^'"]+|@phosphor-icons\/[^'"]+|@radix-ui\/react-icons)['"]/
const SCROLLS = /\boverflow-(x-|y-)?(auto|scroll)\b/

const isDesignFile = (path: string) => /(^|\/)\.miso\/(views|widgets|ui)\/.*\.tsx$/.test(path)
// A widget's own file, not a helper whose name starts with _.
const isWidget = (path: string) => /\/widgets\/[^_/][^/]*\.tsx$/.test(path)

export const usesOtherIcons = (path: string, text: string): boolean => isDesignFile(path) && OTHER_ICONS.test(text)
export const widgetScrolls = (path: string, text: string): boolean => isDesignFile(path) && isWidget(path) && SCROLLS.test(text)

/** What breaks the checkable rules, in words for the person (or AI) who wrote the file. */
export function designProblems(path: string, text: string): string[] {
  return [
    ...(usesOtherIcons(path, text) ? [`${path}: icons come from @tabler/icons-react only.`] : []),
    ...(widgetScrolls(path, text) ? [`${path}: a widget never scrolls. Remove overflow-auto/scroll and show less when the box is small.`] : [])
  ]
}
