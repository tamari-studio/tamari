// Scoring: what articles are scored on. Each criterion has a description (what the AI looks for
// when it rates an article 0–10) and a weight. The score is the weighted average, worked out in
// code, so a weight change re-ranks every article at once with no AI call. Suggest asks the AI
// for descriptions and weights; values edited by hand are marked and Suggest leaves them alone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconAlertTriangle, IconHandStop, IconSparkles } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Spinner } from '../ui/spinner'
import { Textarea } from '../ui/textarea'
import { ErrorLine, friendlyError, KeyMissing, PageHeader, timeOut, when, type Load } from './_ui'
import { getScoring, saveScoring, suggestScoring } from './news.server'
import type { ScoringEdit, ScoringSettings } from './_scoring'

export const config = {
  title: 'Scoring',
  icon: 'target'
} as const

type Data = { settings: ScoringSettings; hasKey: boolean }

function toEdit(settings: ScoringSettings): ScoringEdit {
  return {
    maxAgeDays: settings.maxAgeDays,
    minScore: settings.minScore,
    criteria: settings.criteria.map(({ id, description, weight }) => ({ id, description, weight }))
  }
}

function HandMark({ label }: { label: string }) {
  return (
    <Badge variant="secondary" title="Suggest leaves this value alone">
      <IconHandStop className="size-3" stroke={1.75} />
      {label}
    </Badge>
  )
}

export default function Scoring() {
  const [data, setData] = useState<Load<Data>>({ kind: 'loading' })
  const [edit, setEdit] = useState<ScoringEdit | null>(null)
  const [busy, setBusy] = useState<null | 'save' | 'suggest'>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const load = useCallback(() => {
    getScoring().then(
      value => {
        setData({ kind: 'ready', value })
        setEdit(toEdit(value.settings))
      },
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  const settings = data.kind === 'ready' ? data.value.settings : null
  const dirty = useMemo(
    () => Boolean(settings && edit && JSON.stringify(toEdit(settings)) !== JSON.stringify(edit)),
    [settings, edit]
  )
  const totalWeight = edit ? edit.criteria.reduce((sum, c) => sum + Math.max(0, c.weight || 0), 0) : 0

  function setCriterion(id: string, patch: Partial<{ description: string; weight: number }>) {
    setEdit(current => current && { ...current, criteria: current.criteria.map(c => (c.id === id ? { ...c, ...patch } : c)) })
  }

  async function save() {
    if (!edit) return
    setBusy('save')
    setMessage(null)
    try {
      const next = await timeOut(saveScoring(edit))
      setData(current => (current.kind === 'ready' ? { kind: 'ready', value: { ...current.value, settings: next } } : current))
      setEdit(toEdit(next))
      setMessage({ kind: 'ok', text: 'Saved. Articles and the next drafts use the new settings.' })
    } catch (err) {
      setMessage({ kind: 'error', text: friendlyError(err) })
    } finally {
      setBusy(null)
    }
  }

  async function suggest() {
    setBusy('suggest')
    setMessage(null)
    try {
      const outcome = await timeOut(suggestScoring())
      if (!outcome.ok) {
        setMessage({ kind: 'error', text: outcome.error })
        return
      }
      setData(current => (current.kind === 'ready' ? { kind: 'ready', value: { ...current.value, settings: outcome.settings } } : current))
      setEdit(toEdit(outcome.settings))
      setMessage({
        kind: 'ok',
        text: outcome.changed === 0 ? 'The AI suggested no changes.' : `The AI changed ${outcome.changed} ${outcome.changed === 1 ? 'criterion' : 'criteria'}. Values edited by hand were kept.`
      })
    } catch (err) {
      setMessage({ kind: 'error', text: friendlyError(err) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <PageHeader title="Scoring">
          {settings && (settings.updatedAt || settings.suggestedAt) && (
            <span className="text-sm text-muted-foreground">
              {settings.updatedAt && `Edited ${when(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}`}
              {settings.updatedAt && settings.suggestedAt && '; '}
              {settings.suggestedAt && `AI suggestion ${when(settings.suggestedAt)}`}
            </span>
          )}
        </PageHeader>

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16" />
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}

        {data.kind === 'ready' && edit && settings && (
          <>
            <p className="text-sm text-muted-foreground">
              The AI rates every article 0–10 on each criterion, following its description. An article's score is the weighted
              average, 0–100. Weights and filters apply at once; a changed description applies to articles rated from then on.
            </p>
            {!data.value.hasKey && <KeyMissing />}

            <section aria-labelledby="filters" className="flex flex-col gap-3">
              <h2 id="filters" className="text-base font-medium">
                Filters
              </h2>
              <div className="flex flex-wrap gap-6">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span>Maximum age in days</span>
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    className="w-24 tabular-nums"
                    value={edit.maxAgeDays}
                    onChange={e => setEdit({ ...edit, maxAgeDays: Number(e.target.value) })}
                  />
                  <span className="text-muted-foreground">Older articles aren't fetched, shown or drafted (1–7)</span>
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span>Minimum score</span>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="w-24 tabular-nums"
                    value={edit.minScore}
                    onChange={e => setEdit({ ...edit, minScore: Number(e.target.value) })}
                  />
                  <span className="text-muted-foreground">Lower scores are hidden in Articles and never drafted</span>
                </label>
              </div>
            </section>

            <section aria-labelledby="criteria" className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="criteria" className="text-base font-medium">
                  Criteria
                </h2>
                <Button variant="outline" size="sm" onClick={suggest} disabled={busy !== null || !data.value.hasKey || dirty}>
                  {busy === 'suggest' ? <Spinner data-icon="inline-start" /> : <IconSparkles data-icon="inline-start" stroke={1.75} />}
                  {busy === 'suggest' ? 'Suggesting' : 'Suggest'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Suggest asks the AI for descriptions and weights, from the channel's goal and the posts people approved or rejected.
                It fills every value not edited by hand.{dirty ? ' Save or discard your changes first.' : ''}
              </p>
              <ul className="flex flex-col">
                {edit.criteria.map(criterion => {
                  const saved = settings.criteria.find(c => c.id === criterion.id)!
                  const share = totalWeight > 0 ? Math.round((Math.max(0, criterion.weight || 0) / totalWeight) * 100) : 0
                  return (
                    <li key={criterion.id} className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium">{saved.name}</span>
                        {saved.byHand.weight && <HandMark label="Weight edited by hand" />}
                        {saved.byHand.description && <HandMark label="Description edited by hand" />}
                        <label className="ml-auto flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">Weight</span>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            className="w-20 tabular-nums"
                            value={criterion.weight}
                            aria-label={`${saved.name} weight`}
                            onChange={e => setCriterion(criterion.id, { weight: Number(e.target.value) })}
                          />
                          <span className="w-16 text-right tabular-nums text-muted-foreground">{share}% of score</span>
                        </label>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                      <Textarea
                        value={criterion.description}
                        rows={3}
                        maxLength={600}
                        aria-label={`${saved.name}: what the AI looks for`}
                        onChange={e => setCriterion(criterion.id, { description: e.target.value })}
                      />
                      {saved.suggestionNote && <p className="text-sm text-muted-foreground">AI: {saved.suggestionNote}</p>}
                    </li>
                  )
                })}
              </ul>
            </section>

            {message && (
              <Alert variant={message.kind === 'error' ? 'destructive' : 'default'}>
                {message.kind === 'error' && <IconAlertTriangle stroke={1.75} />}
                {message.kind === 'error' && <AlertTitle>Not done</AlertTitle>}
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}

            <div className="sticky bottom-0 flex gap-2 border-t border-border bg-background py-3">
              <Button onClick={save} disabled={!dirty || busy !== null}>
                {busy === 'save' && <Spinner data-icon="inline-start" />}
                Save changes
              </Button>
              <Button variant="ghost" onClick={() => setEdit(toEdit(settings))} disabled={!dirty || busy !== null}>
                Discard
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
