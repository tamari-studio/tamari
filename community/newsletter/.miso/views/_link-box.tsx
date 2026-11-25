// "Write from a link" at the top of the Posts tab: paste a link (and, for a paywalled page, the
// article text). Three server steps run one after another, each under the hosted 60 s cap: read
// the article, check its claims on the web, write the post. The new draft appears in the list.
import { useState } from 'react'
import { IconAlertTriangle, IconLink } from '@tabler/icons-react'

import { Alert, AlertDescription } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Spinner } from '../ui/spinner'
import { Textarea } from '../ui/textarea'
import { CHANNEL } from './_channel'
import { friendlyError, timeOut } from './_ui'
import { addLink, researchLink, writeLinkPost } from './news.server'

const STEPS = ['Reading the article', 'Checking its claims on the web', 'Writing the post'] as const

export function LinkBox({ hasKey, onWritten }: { hasKey: boolean; onWritten: () => void }) {
  const [link, setLink] = useState('')
  const [text, setText] = useState('')
  const [showText, setShowText] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function run() {
    setError(null)
    setDone(null)
    try {
      setStep(0)
      const added = await timeOut(addLink(link, showText ? text : ''))
      if (!added.ok) {
        setError(added.error)
        if (/paste the article text/i.test(added.error)) setShowText(true)
        return
      }
      setStep(1)
      const researched = await timeOut(researchLink(added.key))
      if (!researched.ok) return setError(researched.error)
      setStep(2)
      const written = await timeOut(writeLinkPost(added.key))
      if (!written.ok) return setError(written.error)
      const checked = researched.research.claims.filter(c => c.status !== 'unverified').length
      setDone(`Drafted a post from ${added.site}: ${checked} of ${researched.research.claims.length} claims checked against other sources. It is in the list below.`)
      setLink('')
      setText('')
      setShowText(false)
      onWritten()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setStep(null)
    }
  }

  const busy = step !== null
  return (
    <section aria-labelledby="link-box" className="flex flex-col gap-2">
      <h2 id="link-box" className="text-base font-medium">
        Write from a link
      </h2>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={e => {
          e.preventDefault()
          if (link.trim() && !busy) void run()
        }}
      >
        <Input
          type="url"
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder="Paste a link to an article"
          aria-label="Article link"
          className="min-w-0 flex-1"
          disabled={busy}
        />
        <Button type="submit" disabled={!link.trim() || busy || !hasKey}>
          {busy ? <Spinner data-icon="inline-start" /> : <IconLink data-icon="inline-start" stroke={1.75} />}
          {busy ? STEPS[step!] : 'Write a post'}
        </Button>
      </form>
      {showText ? (
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          maxLength={8000}
          placeholder="Paste the article text here when the page is behind a paywall or can't be read"
          aria-label="Article text"
          disabled={busy}
        />
      ) : (
        <button type="button" className="self-start text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => setShowText(true)}>
          Page behind a paywall? Paste the article text
        </button>
      )}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {busy
          ? `${STEPS[step!]} (step ${step! + 1} of 3, up to a minute)`
          : hasKey
            ? `The article is read, its main claims are checked against other sources on the web, and a draft is written in the ${CHANNEL.name} tone. It does not take one of the day’s two posts.`
            : 'Needs the AI key (NEWSLETTER_ANTHROPIC_KEY) to check claims and write.'}
      </p>
      {done && <p className="text-sm">{done}</p>}
      {error && (
        <Alert variant="destructive">
          <IconAlertTriangle stroke={1.75} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}
