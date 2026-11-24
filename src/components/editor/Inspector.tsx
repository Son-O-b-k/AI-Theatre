// The selected element's settings, in plain words. Each field is applied when you leave it (or pick
// an option), checked the same way as what the AI writes, and re-times the chapter.

import { Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { KIND_NAMES, nameOf, onBoard, removeElement, setBoardTitle, updateElement } from '../../scene/edit'
import { ICON_NAMES, ILLUSTRATION_NAMES } from '../../scene/library'
import { PALETTE } from '../../scene/palette'
import type { Element, Scene } from '../../scene/schema'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'

interface Props {
  scene: Scene
  /** An element id, or a screen title ("title-2"). */
  id: string
  onChange(scene: Scene): void
  onClose(): void
}

const TITLE = /^title-(\d+)$/

export function Inspector({ scene, id, onChange, onClose }: Props) {
  const [error, setError] = useState<string | null>(null)
  const el = scene.elements.find((candidate) => candidate.id === id)
  const titleBoard = TITLE.exec(id)

  /** Applies a change, or shows why it cannot be made. */
  const apply = (change: () => Scene) => {
    try {
      onChange(change())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const set = (fields: Record<string, unknown>) => apply(() => updateElement(scene, id, fields))

  let heading: string
  let body: ReactNode
  if (titleBoard) {
    const board = Number(titleBoard[1]) - 1
    heading = `Screen ${board + 1} title`
    body = (
      <TextField label="Title" value={scene.boards[board]?.title ?? ''} onCommit={(title) => apply(() => setBoardTitle(scene, board, title))} />
    )
  } else if (el) {
    heading = `${KIND_NAMES[el.kind]} · ${nameOf(scene, id)}`
    body = (
      <>
        <Fields scene={scene} el={el} set={set} />
        <Colours value={el.color} onPick={(color) => set({ color })} />
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 text-danger hover:bg-danger/10 hover:text-danger"
          onClick={() => apply(() => removeElement(scene, id))}
        >
          <Trash2 className="size-3.5" /> Remove from chapter
        </Button>
      </>
    )
  } else {
    return null
  }

  return (
    <div className="rounded-xl border border-accent/30 bg-raised p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{heading}</p>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="space-y-2.5">{body}</div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function Fields({ scene, el, set }: { scene: Scene; el: Element; set(fields: Record<string, unknown>): void }) {
  const label = <TextField label="Label" value={el.label ?? ''} onCommit={(value) => set({ label: value || undefined })} />
  switch (el.kind) {
    case 'box':
    case 'circle':
      return (
        <>
          {label}
          <Choice label="Icon" value={el.icon ?? ''} options={['', ...ICON_NAMES]} none="No icon" onPick={(icon) => set({ icon: icon || undefined })} />
        </>
      )
    case 'icon':
      return (
        <>
          {label}
          <Choice label="Icon" value={el.icon} options={ICON_NAMES} onPick={(icon) => set({ icon })} />
        </>
      )
    case 'illustration':
      return (
        <>
          {label}
          <Choice label="Drawing" value={el.art} options={ILLUSTRATION_NAMES} onPick={(art) => set({ art })} />
        </>
      )
    case 'text':
      return <TextField label="Note" multiline value={el.text} onCommit={(text) => set({ text })} />
    case 'counter':
      return (
        <>
          {label}
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Counts from" value={String(el.from)} onCommit={(from) => set({ from: Number(from) })} />
            <TextField label="Counts to" value={String(el.to)} onCommit={(to) => set({ to: Number(to) })} />
            <TextField label="Before the number" value={el.prefix} placeholder="e.g. $" onCommit={(prefix) => set({ prefix })} />
            <TextField label="After the number" value={el.suffix} placeholder="e.g. %" onCommit={(suffix) => set({ suffix })} />
          </div>
        </>
      )
    case 'chart':
      return (
        <>
          {label}
          <TextField
            label="Bars, one per line: label: value"
            multiline
            value={el.bars.map((bar) => `${bar.label}: ${bar.value}`).join('\n')}
            onCommit={(text) => set({ bars: pairs(text).map(([label, value]) => ({ label, value: Number(value) })) })}
          />
          <TextField label="Unit" value={el.unit ?? ''} placeholder="e.g. %, $, kg" onCommit={(unit) => set({ unit: unit || undefined })} />
        </>
      )
    case 'timeline':
      return (
        <>
          {label}
          <TextField
            label="Moments, one per line: date: what happened"
            multiline
            value={el.points.map((point) => `${point.at}: ${point.label}`).join('\n')}
            onCommit={(text) => set({ points: pairs(text).map(([at, label]) => ({ at, label })) })}
          />
        </>
      )
    case 'table':
      return (
        <>
          {label}
          <TextField
            label="Rows, cells separated by | (the first row is the heading)"
            multiline
            value={[el.columns, ...el.rows].map((row) => row.join(' | ')).join('\n')}
            onCommit={(text) => {
              const [columns = [], ...rows] = lines(text).map((line) => line.split('|').map((cell) => cell.trim()))
              set({ columns, rows })
            }}
          />
        </>
      )
    case 'group': {
      const shapes = onBoard(scene, el.boards[0]).filter((other) => other.kind !== 'link' && other.kind !== 'group' && other.kind !== 'text')
      return (
        <>
          {label}
          <fieldset>
            <legend className="mb-1 text-xs text-dim">Inside the frame</legend>
            {shapes.map((shape) => (
              <label key={shape.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={el.contains.includes(shape.id)}
                  onChange={(e) => set({ contains: e.target.checked ? [...el.contains, shape.id] : el.contains.filter((member) => member !== shape.id) })}
                />
                {nameOf(scene, shape.id)}
              </label>
            ))}
          </fieldset>
        </>
      )
    }
    case 'link':
      return (
        <>
          {label}
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={el.dashed} onChange={(e) => set({ dashed: e.target.checked })} /> Dashed line
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={el.arrow} onChange={(e) => set({ arrow: e.target.checked })} /> Arrowhead
          </label>
        </>
      )
    case 'dot':
      return <p className="text-xs text-dim">A dot that a step sends along an arrow. Removing it also removes that trip from the step.</p>
    case 'photo':
      return (
        <>
          {label}
          <Choice label="Look" value={el.look ?? 'photo'} options={['photo', 'sketch']} onPick={(look) => set({ look })} />
          {el.credit && <p className="text-xs text-dim">{el.credit}</p>}
        </>
      )
    case 'pin':
      return (
        <>
          {label}
          <p className="text-xs text-dim">Marks “{el.spot}” on {nameOf(scene, el.on)}. Removing the picture removes its pins.</p>
        </>
      )
  }
}

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)
/** "label: value" lines; the value is after the last colon, so labels may contain one. */
const pairs = (text: string) =>
  lines(text).map((line) => {
    const at = line.lastIndexOf(':')
    return at === -1 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()]
  })

const INPUT = 'w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13px] outline-none focus:border-accent/60'

function TextField(props: { label: string; value: string; placeholder?: string; multiline?: boolean; onCommit(value: string): void }) {
  const commit = (value: string) => value.trim() !== props.value && props.onCommit(value.trim())
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-dim">{props.label}</span>
      {props.multiline ? (
        <textarea
          key={props.value}
          rows={4}
          defaultValue={props.value}
          placeholder={props.placeholder}
          onBlur={(e) => commit(e.target.value)}
          className={cx(INPUT, 'resize-y leading-relaxed')}
        />
      ) : (
        <input
          key={props.value}
          defaultValue={props.value}
          placeholder={props.placeholder}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={INPUT}
        />
      )}
    </label>
  )
}

function Choice(props: { label: string; value: string; options: string[]; none?: string; onPick(value: string): void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-dim">{props.label}</span>
      <select value={props.value} onChange={(e) => props.onPick(e.target.value)} className={INPUT}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option ? option.replace(/-/g, ' ') : props.none}
          </option>
        ))}
      </select>
    </label>
  )
}

function Colours({ value, onPick }: { value: string; onPick(color: string): void }) {
  return (
    <div>
      <span className="mb-1 block text-xs text-dim">Colour</span>
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(PALETTE) as [string, string][]).map(([name, hex]) => (
          <button
            key={name}
            title={name}
            aria-label={name}
            onClick={() => onPick(name)}
            className={cx(
              'size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-raised transition hover:scale-110',
              hex === value.toLowerCase() ? 'ring-2 ring-ink' : 'ring-1 ring-ink/15',
            )}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  )
}
