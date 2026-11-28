// The chapter editor: the chapter as its screens and steps, in plain words. A step is one line of
// narration and what happens on screen while it is said. Clicking anything (here or on the stage)
// selects it for the inspector; clicking a step shows that moment on the stage.

import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addAction, describeAction, insertBeat, nameOf, onBoard, removeAction } from '../../scene/edit'
import { PALETTE } from '../../scene/palette'
import type { Action, Scene } from '../../scene/schema'
import { formatTime } from '../../format'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'
import { Inspector } from './Inspector'

interface Props {
  scene: Scene
  /** The selected element (or screen title), shown in the inspector and outlined on stage. */
  selected: string | null
  onSelect(id: string | null): void
  /** A change to the storyboard; the chapter is re-timed. */
  onChange(scene: Scene): void
  /** Changes (or, with null, removes) one step's narration; changed lines are recorded again. */
  onNarrationChange(index: number, text: string | null): void
  onSeek(seconds: number): void
  /** The step being said, while previewing. */
  cueIndex: number | null
  className?: string
}

/** When each step starts on the timeline, and the moment that shows what it did (just before the next). */
function stepTimes(scene: Scene): { start: number; shown: number }[] {
  let cue = 0
  const starts = scene.beats.map((beat) => (beat.say ? (scene.cues[cue++]?.t ?? null) : null))
  return starts.map((start, i) => {
    const from = start ?? starts.slice(0, i).reverse().find((t) => t !== null) ?? 0
    const next = starts.slice(i + 1).find((t) => t !== null) ?? scene.duration
    return { start: from, shown: Math.max(from, next - 0.3) }
  })
}

export function ChapterEditor({ scene, selected, onSelect, onChange, onNarrationChange, onSeek, cueIndex, className }: Props) {
  const times = stepTimes(scene)
  // The step being said: the cue index counts only steps with narration.
  const sayingIndex = cueIndex === null ? -1 : scene.beats.findIndex((_, i) => scene.beats.slice(0, i + 1).filter((b) => b.say).length === cueIndex + 1)
  const selectedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selected])

  return (
    <aside className={cx('flex min-h-0 flex-col border-l border-line bg-panel', className)}>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <div ref={selectedRef}>
          {selected ? (
            <Inspector key={selected} scene={scene} id={selected} onChange={onChange} onClose={() => onSelect(null)} />
          ) : (
            <p className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-[13px] leading-relaxed text-dim">
              Click anything on the stage, or a name below, to change it. Click a step to see that moment.
            </p>
          )}
        </div>

        {scene.boards.map((board, b) => {
          const steps = scene.beats.map((beat, i) => ({ beat, i })).filter(({ beat }) => beat.board === b)
          return (
            <section key={b}>
              <button
                onClick={() => onSelect(`title-${b + 1}`)}
                className="mb-1.5 w-full cursor-pointer rounded-md px-1 text-left hover:bg-tint"
              >
                <span className="block text-[11px] font-semibold tracking-wider text-faint uppercase">Screen {b + 1}</span>
                <span className="block truncate text-sm font-semibold">{board.title || 'Untitled screen'}</span>
              </button>

              <div className="mb-2 flex flex-wrap gap-1 px-1">
                {onBoard(scene, b).map((el) => (
                  <button
                    key={el.id}
                    onClick={() => onSelect(el.id)}
                    className={cx(
                      'max-w-full cursor-pointer truncate rounded-full border px-2 py-0.5 text-xs transition',
                      selected === el.id ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-raised text-dim hover:text-ink',
                    )}
                  >
                    {nameOf(scene, el.id)}
                  </button>
                ))}
              </div>

              <ol className="space-y-2">
                {steps.map(({ beat, i }) => (
                  <li key={`${i}:${beat.say}`}>
                    <Step
                      scene={scene}
                      index={i}
                      number={i + 1}
                      time={times[i].start}
                      saying={i === sayingIndex}
                      onShow={() => onSeek(times[i].shown)}
                      onChange={onChange}
                      onNarrationChange={onNarrationChange}
                    />
                  </li>
                ))}
              </ol>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => onChange(insertBeat(scene, steps.at(-1)?.i ?? scene.beats.length - 1, ''))}
              >
                <Plus className="size-3.5" /> Add a step to this screen
              </Button>
            </section>
          )
        })}
      </div>
    </aside>
  )
}

interface StepProps {
  scene: Scene
  index: number
  number: number
  time: number
  saying: boolean
  onShow(): void
  onChange(scene: Scene): void
  onNarrationChange(index: number, text: string | null): void
}

function Step({ scene, index, number, time, saying, onShow, onChange, onNarrationChange }: StepProps) {
  const beat = scene.beats[index]
  return (
    <div className={cx('rounded-xl border bg-raised p-2 transition', saying ? 'border-accent/40' : 'border-line')}>
      <div className="mb-1.5 flex items-center gap-2">
        <button onClick={onShow} className="flex cursor-pointer items-center gap-2 rounded-md pr-2 hover:bg-tint" title="Show this moment">
          <span className="grid size-6 place-items-center rounded-md bg-tint text-[11px] font-semibold tabular-nums">{number}</span>
          <span className="text-xs text-faint tabular-nums">{formatTime(time)}</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label="Remove this step"
          title="Remove this step"
          onClick={() => onNarrationChange(index, null)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {/* Timing follows the words, so a change is applied when you leave the field. */}
      <textarea
        rows={2}
        defaultValue={beat.say}
        placeholder="What is said (leave empty for a pause)"
        onBlur={(e) => {
          const text = e.target.value.trim()
          if (text !== beat.say) onNarrationChange(index, text)
        }}
        className="w-full resize-y rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-accent/60"
      />
      <ul className="mt-1.5 space-y-1">
        {beat.actions.map((action, a) => (
          <li key={a} className="group flex items-start gap-1.5 text-xs text-dim">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent/60" />
            <span className="flex-1 leading-relaxed">{describeAction(scene, action)}</span>
            <button
              onClick={() => onChange(removeAction(scene, index, a))}
              aria-label="Remove"
              className="cursor-pointer rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-tint focus-visible:opacity-100"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <AddAction scene={scene} board={beat.board} onAdd={(action) => onChange(addAction(scene, index, action))} />
    </div>
  )
}

const ACTIONS = {
  show: 'Show',
  hide: 'Hide',
  focus: 'Spotlight',
  highlight: 'Change colour of',
  pulse: 'Pulse',
  travel: 'Send a dot along',
  zoom: 'Zoom in on',
  unzoom: 'Zoom back out of',
  fill: 'Fill',
  tab: 'Move the tabs of',
} as const

const FILL_LEVELS = [0, 10, 25, 50, 75, 90, 100]

/** "Show [The Brain] [Add]": what happens during a step, built from the things on its screen. */
function AddAction({ scene, board, onAdd }: { scene: Scene; board: number; onAdd(action: Action): void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<keyof typeof ACTIONS>('show')
  const [target, setTarget] = useState('')
  const [color, setColor] = useState<keyof typeof PALETTE>('amber')
  const [amount, setAmount] = useState(100)
  const [tab, setTab] = useState(1)
  // Zooming moves in on a pin of a picture, or back out of the picture.
  const things = onBoard(scene, board).filter((el) =>
    type === 'travel'
      ? el.kind === 'link'
      : type === 'zoom'
        ? el.kind === 'pin'
        : type === 'unzoom'
          ? el.kind === 'photo'
          : type === 'fill'
            ? el.kind === 'illustration'
            : type === 'tab'
              ? el.kind === 'tabs'
              : true,
  )
  const chosen = things.some((el) => el.id === target) ? target : (things[0]?.id ?? '')

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 flex cursor-pointer items-center gap-1 rounded px-1 text-xs text-faint hover:text-ink">
        <Plus className="size-3" /> What happens
      </button>
    )
  }

  const add = () => {
    if (!chosen) return
    const pin = scene.elements.find((el) => el.id === chosen)
    onAdd(
      type === 'travel'
        ? { type, token: `${chosen}-dot`, along: chosen, color, reverse: false }
        : type === 'highlight'
          ? { type, ids: [chosen], color }
          : type === 'zoom'
            ? { type, ids: [pin?.kind === 'pin' ? pin.on : chosen], spot: chosen, scale: undefined }
            : type === 'unzoom'
              ? { type: 'zoom', ids: [chosen], spot: undefined, scale: undefined }
              : type === 'fill'
                ? { type, ids: [chosen], to: amount / 100 }
                : type === 'tab'
                  ? { type, ids: [chosen], to: tab }
                  : { type, ids: [chosen], fx: undefined },
    )
    setOpen(false)
  }

  const select = 'min-w-0 rounded-md border border-line bg-canvas px-1.5 py-1 text-xs outline-none focus:border-accent/60'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <select value={type} onChange={(e) => setType(e.target.value as keyof typeof ACTIONS)} className={select}>
        {Object.entries(ACTIONS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select value={chosen} onChange={(e) => setTarget(e.target.value)} className={cx(select, 'flex-1')}>
        {things.length === 0 && (
          <option value="">
            {type === 'travel'
              ? 'No arrows on this screen'
              : type === 'zoom'
                ? 'No pins on this screen'
                : type === 'unzoom'
                  ? 'No pictures on this screen'
                  : type === 'fill'
                    ? 'No drawings on this screen'
                    : type === 'tab'
                      ? 'No tabs on this screen'
                      : 'Nothing on this screen'}
          </option>
        )}
        {things.map((el) => (
          <option key={el.id} value={el.id}>
            {nameOf(scene, el.id)}
          </option>
        ))}
      </select>
      {(type === 'highlight' || type === 'travel') && (
        <select value={color} onChange={(e) => setColor(e.target.value as keyof typeof PALETTE)} className={select}>
          {Object.keys(PALETTE).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      )}
      {type === 'fill' && (
        <select value={amount} onChange={(e) => setAmount(Number(e.target.value))} className={select} aria-label="How full">
          {FILL_LEVELS.map((level) => (
            <option key={level} value={level}>
              to {level}%
            </option>
          ))}
        </select>
      )}
      {type === 'tab' && (
        <select value={tab} onChange={(e) => setTab(Number(e.target.value))} className={select} aria-label="Which tab">
          {(() => {
            const tabs = scene.elements.find((el) => el.id === chosen)
            return (tabs?.kind === 'tabs' ? tabs.items : []).map((item, i) => (
              <option key={item} value={i + 1}>
                to {item}
              </option>
            ))
          })()}
        </select>
      )}
      <Button size="sm" variant="primary" disabled={!chosen} onClick={add}>
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  )
}
