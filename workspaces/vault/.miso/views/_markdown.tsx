import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { linkTarget } from '../lib/links'

const LINK = 'underline underline-offset-2 hover:text-foreground'

/**
 * A note's Markdown as React elements. HTML inside the note is shown as text, never run: there is
 * no raw-HTML plugin and nothing is set as inner HTML. Links go through linkTarget, and an image
 * becomes a link, so opening a note never loads anything from another site.
 */
export function NoteBody({ text, path, notes, onOpen }: { text: string; path: string; notes: ReadonlySet<string>; onOpen: (path: string) => void }) {
  const components: Components = {
    a({ href, children }) {
      const target = linkTarget(href, path, notes)
      if (target.kind === 'web') {
        return (
          <a href={target.href} target="_blank" rel="noreferrer noopener" className={LINK}>
            {children}
          </a>
        )
      }
      if (target.kind === 'note') {
        return (
          <button type="button" onClick={() => onOpen(target.path)} className={`${LINK} text-left`}>
            {children}
          </button>
        )
      }
      return <span>{children}</span>
    },
    img({ src, alt }) {
      const target = linkTarget(src, path, notes)
      const label = alt ? `Image: ${alt}` : 'Image'
      if (target.kind !== 'web') return <span className="text-muted-foreground">{label}</span>
      return (
        <a href={target.href} target="_blank" rel="noreferrer noopener" className={LINK}>
          {label}
        </a>
      )
    },
    h1: ({ children }) => <h2 className="mt-6 mb-2 text-xl font-semibold first:mt-0">{children}</h2>,
    h2: ({ children }) => <h3 className="mt-6 mb-2 text-lg font-semibold first:mt-0">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-4 mb-1 text-base font-medium first:mt-0">{children}</h4>,
    h4: ({ children }) => <h5 className="mt-4 mb-1 text-sm font-medium first:mt-0">{children}</h5>,
    h5: ({ children }) => <h6 className="mt-4 mb-1 text-sm font-medium first:mt-0">{children}</h6>,
    h6: ({ children }) => <h6 className="mt-4 mb-1 text-sm font-medium first:mt-0">{children}</h6>,
    p: ({ children }) => <p className="my-3 leading-6 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => <ul className="my-3 list-disc pl-5">{children}</ul>,
    ol: ({ children, start }) => (
      <ol start={start} className="my-3 list-decimal pl-5">
        {children}
      </ol>
    ),
    // A checklist item shows its checkbox instead of a bullet.
    li: ({ children }) => <li className="my-1 leading-6 has-[>input]:-ml-5 has-[>input]:list-none">{children}</li>,
    blockquote: ({ children }) => <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
    hr: () => <hr className="my-6" />,
    pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-accent p-3 font-mono text-xs leading-5 [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
    code: ({ children }) => <code className="rounded-xs bg-accent px-1.5 py-0.5 font-mono text-xs">{children}</code>,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full text-left text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b px-2 py-1.5 font-medium">{children}</th>,
    td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
    input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} readOnly disabled className="mr-1.5 align-middle" />
  }
  return (
    <div className="text-sm break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
