// Changes made by hand in the chapter editor, on the storyboard itself: the same screens, things
// and steps the AI writes. Each function returns a new scene; project.ts re-times it afterwards.
// Names and descriptions here are what the editor shows, so they are in plain words, never ids.

import { PALETTE, toHex } from './palette'
import { fitLabel } from './scene'
import { describeError, ElementSchema, LinkSchema, type Action, type Element, type ElementKind, type Scene } from './schema'

export const KIND_NAMES: Record<ElementKind, string> = {
  box: 'Card',
  circle: 'Circle',
  icon: 'Icon',
  dot: 'Moving dot',
  text: 'Note',
  illustration: 'Drawing',
  chart: 'Chart',
  counter: 'Number',
  timeline: 'Timeline',
  table: 'Table',
  group: 'Frame',
  link: 'Arrow',
}

const find = (scene: Scene, id: string) => scene.elements.find((el) => el.id === id)
const short = (text: string) => (text.length > 32 ? `${text.slice(0, 30)}…` : text)

/** What the editor calls an element: its label, its text, or what it is. */
export function nameOf(scene: Scene, id: string): string {
  const el = find(scene, id)
  if (!el) return 'something removed'
  if (el.kind === 'link') return el.label ? `“${el.label}” arrow` : `${nameOf(scene, el.from)} → ${nameOf(scene, el.to)}`
  if (el.kind === 'text') return `“${short(el.text)}”`
  if (el.label) return el.label
  if (el.kind === 'illustration') return el.art.replace(/-/g, ' ')
  if (el.kind === 'counter') return `${el.prefix}${el.to}${el.suffix}`
  return KIND_NAMES[el.kind]
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** The name of a palette colour, for a colour given as a name or as hex. */
export function colorName(color: string): string {
  const hex = toHex(color).toLowerCase()
  return (Object.keys(PALETTE) as (keyof typeof PALETTE)[]).find((name) => PALETTE[name] === hex) ?? 'another colour'
}

/** One action in plain words, e.g. "Shows The Brain and User Info". */
export function describeAction(scene: Scene, action: Action): string {
  const names = action.type === 'travel' ? '' : list(action.ids.map((id) => nameOf(scene, id)))
  switch (action.type) {
    case 'show':
      return `Shows ${names}`
    case 'hide':
      return `Hides ${names}`
    case 'focus':
      return `Spotlights ${names}, dimming the rest`
    case 'highlight':
      return `Turns ${names} ${colorName(action.color)}`
    case 'pulse':
      return `Pulses ${names}`
    case 'travel':
      return `Sends a dot ${action.reverse ? 'back ' : ''}along ${nameOf(scene, action.along)}`
  }
}

/**
 * Changes an element's fields, checked the same way as what the AI writes; throws an Error with a
 * readable message when a value does not fit (an empty label, a chart without bars...).
 */
export function updateElement(scene: Scene, id: string, fields: Record<string, unknown>): Scene {
  const el = find(scene, id)
  if (!el) return scene
  const { boards, ...current } = el
  const input = { ...current, ...fields }
  const parsed = el.kind === 'link' ? LinkSchema.safeParse(input) : ElementSchema.safeParse(input)
  if (!parsed.success) throw new Error(describeError(parsed.error))
  const color = toHex(parsed.data.color ?? el.color)
  const next = (el.kind === 'link' ? { ...parsed.data, kind: 'link', color, boards } : fitLabel({ ...parsed.data, color, boards } as Element)) as Element
  return { ...scene, elements: scene.elements.map((other) => (other.id === id ? next : other)) }
}

/** Takes an element out of the chapter, with the arrows to it and every step's mention of it. */
export function removeElement(scene: Scene, id: string): Scene {
  const gone = new Set([id, ...scene.elements.filter((el) => el.kind === 'link' && (el.from === id || el.to === id)).map((el) => el.id)])
  const elements = scene.elements.flatMap((el): Element[] => {
    if (gone.has(el.id)) return []
    if (el.kind !== 'group') return [el]
    const contains = el.contains.filter((member) => !gone.has(member))
    return contains.length ? [{ ...el, contains }] : []
  })
  const beats = scene.beats.map((beat) => ({
    ...beat,
    actions: beat.actions.flatMap((action): Action[] => {
      if (action.type === 'travel') return gone.has(action.along) || gone.has(action.token) ? [] : [action]
      const ids = action.ids.filter((other) => !gone.has(other))
      return ids.length ? [{ ...action, ids }] : []
    }),
  }))
  return { ...scene, elements, beats }
}

export function setBoardTitle(scene: Scene, board: number, title: string): Scene {
  return { ...scene, boards: scene.boards.map((b, i) => (i === board ? { ...b, title: title.trim() || undefined } : b)) }
}

/** Adds what happens on screen during a step. A travelling dot is created when first needed. */
export function addAction(scene: Scene, beatIndex: number, action: Action): Scene {
  const beat = scene.beats[beatIndex]
  if (!beat) return scene
  let elements = scene.elements
  if (action.type === 'travel' && !find(scene, action.token)) {
    elements = [...elements, { id: action.token, kind: 'dot', r: 10, color: toHex(action.color ?? 'amber'), boards: [beat.board] }]
  }
  const beats = scene.beats.map((b, i) => (i === beatIndex ? { ...b, actions: [...b.actions, action] } : b))
  return { ...scene, elements, beats }
}

export function removeAction(scene: Scene, beatIndex: number, actionIndex: number): Scene {
  const beats = scene.beats.map((b, i) => (i === beatIndex ? { ...b, actions: b.actions.filter((_, j) => j !== actionIndex) } : b))
  return { ...scene, beats }
}

/** A new step after `after`, on the same screen, saying `say`. */
export function insertBeat(scene: Scene, after: number, say: string): Scene {
  const board = scene.beats[after]?.board ?? Math.max(0, scene.boards.length - 1)
  const beats = [...scene.beats]
  beats.splice(after + 1, 0, { board, say, actions: [] })
  return { ...scene, beats }
}

/** Things that can be shown, hidden or pointed at on a screen (moving dots are managed by their steps). */
export const onBoard = (scene: Scene, board: number) => scene.elements.filter((el) => el.boards.includes(board) && el.kind !== 'dot')
