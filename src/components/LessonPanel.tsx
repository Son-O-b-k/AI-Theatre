import { Check, Loader2, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Output } from '../project'
import { SCENE_VERSION, type Cue } from '../scene/schema'
import { formatTime } from './LessonPlayer'
import { Button } from './ui/Button'
import { cx } from './ui/cx'

export const LIVE = '__live__'

/** Older lessons stored titles as "1. Title"; the panel numbers chapters itself. */
export const chapterTitle = (title: string) => title.replace(/^\d+\.\s*/, '')

interface Props {
  outputs: Output[]
  /** The selected output id, or LIVE when watching the scene being written. */
  selected: string | null
  generating: { titles: string[]; index: number } | null
  writing: boolean
  cueIndex: number | null
  onSelect(id: string): void
  onDelete(id: string): void
  onSeek(seconds: number): void
  /** Replaces (or, with null, removes) one narration line. */
  onNarrationChange(index: number, text: string | null): void
  /** False for chapters in an older format, whose narration cannot be re-timed. */
  editable: boolean
  className?: string
}

export function LessonPanel(props: Props) {
  const [tab, setTab] = useState<'chapters' | 'transcript'>('chapters')
  const output = props.outputs.find((o) => o.id === props.selected) ?? null

  return (
    <aside className={cx('flex min-h-0 flex-col border-l border-line bg-panel', props.className)}>
      <div className="flex h-14 shrink-0 items-center px-3">
        <div className="flex w-full rounded-lg bg-canvas/60 p-1 ring-1 ring-line">
          {(['chapters', 'transcript'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cx(
                'flex-1 cursor-pointer rounded-md py-1.5 text-[13px] font-medium capitalize transition',
                tab === value ? 'bg-raised text-ink shadow-sm' : 'text-dim hover:text-ink',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {tab === 'chapters' ? (
          <Chapters {...props} />
        ) : output ? (
          <Transcript key={output.id} cues={output.scene.cues} {...props} />
        ) : (
          <p className="px-2 pt-2 text-sm text-dim">Select a chapter to see what is said.</p>
        )}
      </div>
    </aside>
  )
}

function Chapters({ outputs, selected, generating, writing, onSelect, onDelete }: Props) {
  const pending = generating ? generating.titles.slice(outputs.length) : writing ? ['Writing…'] : []

  return (
    <ol className="space-y-1">
      {outputs.map((output, index) => {
        const active = output.id === selected
        return (
          <li key={output.id} className="group relative">
            <button
              onClick={() => onSelect(output.id)}
              className={cx(
                'flex w-full cursor-pointer items-start gap-3 rounded-xl p-2.5 pr-10 text-left transition',
                active ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-white/4',
              )}
            >
              <span
                className={cx(
                  'grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold tabular-nums',
                  active ? 'bg-gradient-to-br from-accent to-accent-2 text-canvas' : 'bg-raised text-dim',
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug font-medium">{chapterTitle(output.title)}</span>
                <span className="mt-0.5 block text-xs text-faint">
                  {output.scene.version === SCENE_VERSION
                    ? `${formatTime(output.scene.duration)} · ${output.scene.cues.length} lines`
                    : 'Older format'}
                </span>
              </span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={`Delete ${output.title}`}
              onClick={() => confirm(`Delete “${chapterTitle(output.title)}”?`) && onDelete(output.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        )
      })}

      {pending.map((title, i) => {
        const current = i === 0
        return (
          <li key={`pending-${i}`}>
            <button
              disabled={!current}
              onClick={() => onSelect(LIVE)}
              className={cx(
                'flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition',
                current ? 'cursor-pointer hover:bg-white/4' : 'opacity-50',
                current && selected === LIVE && 'bg-accent/10 ring-1 ring-accent/30',
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-raised text-xs font-semibold text-dim tabular-nums">
                {current ? <Loader2 className="size-3.5 animate-spin text-accent" /> : outputs.length + i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-faint">{current ? 'Writing now · watch it live' : 'Up next'}</span>
              </span>
            </button>
          </li>
        )
      })}

      {outputs.length === 0 && pending.length === 0 && (
        <li className="px-2 pt-2 text-sm text-dim">No chapters yet.</li>
      )}
    </ol>
  )
}

function Transcript({ cues, cueIndex, editable, onSeek, onNarrationChange }: Props & { cues: Cue[] }) {
  const [editing, setEditing] = useState(false)
  const currentRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!editing) currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [cueIndex, editing])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-xs text-faint">{cues.length} lines · click one to jump there</span>
        {editable && (
          <Button variant={editing ? 'active' : 'ghost'} size="sm" onClick={() => setEditing(!editing)}>
            {editing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
            {editing ? 'Done' : 'Edit'}
          </Button>
        )}
      </div>

      {editing ? (
        <ol className="space-y-2">
          {cues.map((cue, index) => (
            <li key={`${index}:${cue.text}`} className="rounded-xl border border-line bg-raised/50 p-2">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs text-faint tabular-nums">{formatTime(cue.t)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto"
                  aria-label="Remove line and what happens on screen during it"
                  onClick={() => onNarrationChange(index, null)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              {/* Timing follows the words, so a change is applied when you leave the field. */}
              <textarea
                rows={3}
                defaultValue={cue.text}
                onBlur={(e) => {
                  const text = e.target.value.trim()
                  if (text && text !== cue.text) onNarrationChange(index, text)
                }}
                className="w-full resize-y rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-accent/60"
              />
            </li>
          ))}
          <p className="px-1 text-xs text-faint">Timing follows the narration, so the animation re-times itself after an edit.</p>
        </ol>
      ) : (
        <ol className="space-y-0.5">
          {cues.map((cue, index) => {
            const current = index === cueIndex
            return (
              <li key={index} ref={current ? currentRef : undefined}>
                <button
                  onClick={() => onSeek(cue.t)}
                  className={cx(
                    'flex w-full cursor-pointer gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/4',
                    current && 'bg-white/5',
                  )}
                >
                  <span className={cx('w-9 shrink-0 pt-px text-xs tabular-nums', current ? 'text-accent' : 'text-faint')}>
                    {formatTime(cue.t)}
                  </span>
                  <span className={cx('text-[13px] leading-relaxed', current ? 'text-ink' : 'text-dim')}>{cue.text}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
