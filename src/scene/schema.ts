// The scene language the AI writes, streamed as JSON Lines ("ops").
// It is a storyboard: boards (screens) of labelled shapes and links, and beats (a spoken
// sentence plus what happens on screen while it is said). The AI never positions or times
// anything: src/scene/layout.ts places each board and src/scene/compile.ts derives the timing.

import { z, ZodError } from 'zod'
import { ICONS, ILLUSTRATIONS } from './library'
import { toColor } from './palette'

export const SCENE_VERSION = 3
export const STAGE = { width: 1280, height: 720 } as const
/** Where diagrams go: below the board title, above the strip where captions are shown. */
export const SAFE = { x0: 60, x1: 1220, y0: 104, y1: 590 } as const
export const TITLE_Y = 54

export const LAYOUTS = ['row', 'column', 'grid', 'flow', 'cycle'] as const
export type Layout = (typeof LAYOUTS)[number]

/** Colours are forgiving: near names map to the palette, anything else falls back to the default. */
const color = z.unknown().transform(toColor)
const id = z.string().regex(/^[A-Za-z][\w-]{0,47}$/, 'ids start with a letter and use letters, digits, - or _')
/** Unknown icon names are dropped rather than failing the whole element. */
const icon = z
  .string()
  .transform((name) => (name in ICONS ? name : undefined))
  .optional()

const ids = z.union([z.string(), z.array(z.string()).min(1)]).transform((value) => (Array.isArray(value) ? value : [value]))

const common = {
  id,
  color: color.optional(),
  label: z.string().optional(),
  labelAt: z.enum(['below', 'above', 'inside']).optional(),
}

/** A bar of a chart: {"label","value"} or ["label", value]. */
const bar = z.union([
  z.object({ label: z.coerce.string(), value: z.coerce.number() }),
  z.tuple([z.coerce.string(), z.coerce.number()]).transform(([label, value]) => ({ label, value })),
])
const moment = z.object({ at: z.coerce.string(), label: z.coerce.string().default('') })

export const ElementSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('box'), w: z.number().min(60).max(400).default(170), h: z.number().min(40).max(300).default(110), icon }),
  z.object({ ...common, kind: z.literal('circle'), r: z.number().min(20).max(150).default(55), icon }),
  z.object({ ...common, kind: z.literal('icon'), icon: z.string().refine((n) => n in ICONS, 'unknown icon'), size: z.number().min(24).max(200).default(72) }),
  z.object({ ...common, kind: z.literal('dot'), r: z.number().min(4).max(30).default(10) }),
  z.object({
    ...common,
    kind: z.literal('text'),
    text: z.string().min(1),
    size: z.number().min(16).max(64).default(28),
    weight: z.number().default(500),
    width: z.number().min(200).max(1100).default(900),
    /** Notes are handwritten; board titles are set in the sans-serif. */
    font: z.enum(['hand', 'sans']).optional(),
  }),
  /** A drawing from content/illustrations; `size` is its longer side. */
  z.object({ ...common, kind: z.literal('illustration'), art: z.string().refine((n) => n in ILLUSTRATIONS, 'unknown illustration'), size: z.number().min(80).max(420).default(230) }),
  /** A bar chart whose bars grow in, with real numbers. */
  z.object({ ...common, kind: z.literal('chart'), bars: z.array(bar).min(1).max(12), unit: z.string().max(12).optional() }),
  /** A number that counts from `from` to `to` as it appears. */
  z.object({
    ...common,
    kind: z.literal('counter'),
    from: z.coerce.number().default(0),
    to: z.coerce.number(),
    prefix: z.string().max(4).default(''),
    suffix: z.string().max(12).default(''),
    decimals: z.number().int().min(0).max(3).default(0),
    size: z.number().min(40).max(120).default(64),
  }),
  /** Dated moments along a line, revealed left to right. */
  z.object({ ...common, kind: z.literal('timeline'), points: z.array(moment).min(2).max(8) }),
  /** A small table, revealed row by row. */
  z.object({
    ...common,
    kind: z.literal('table'),
    columns: z.array(z.coerce.string()).min(1).max(5),
    rows: z.array(z.array(z.coerce.string())).min(1).max(7),
  }),
  /** A labelled frame around other shapes on the board ("Before" / "After", "Inside the cell"). */
  z.object({ ...common, kind: z.literal('group'), contains: ids.pipe(z.array(z.string()).max(8)) }),
])

export const LinkSchema = z.object({
  id,
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  color: color.optional(),
  dashed: z.boolean().default(false),
  arrow: z.boolean().default(true),
})

type ElementInput = z.infer<typeof ElementSchema> | ({ kind: 'link' } & z.infer<typeof LinkSchema>)

/**
 * An element as stored: its colour resolved to hex and the boards it appears on. An element first
 * declared on one board is carried onto later boards that refer to it, and glides to its new place.
 */
export type Element = DistributiveOmit<ElementInput, 'color'> & { color: string; boards: number[] }
export type ElementKind = Element['kind']
export type ElementOf<K extends ElementKind> = Extract<Element, { kind: K }>

export const ANIMATED_PROPS = ['x', 'y', 'rotation', 'scale', 'opacity', 'draw', 'color'] as const
export type AnimatedProp = (typeof ANIMATED_PROPS)[number]

export interface Visual {
  x: number
  y: number
  rotation: number
  scale: number
  opacity: number
  draw: number
  color: string
}

/** An element placed by the layout engine, with its starting values. */
export type SceneElement = Element & Visual & { curve: number }

// ── Actions inside a beat ───────────────────────────────────────────────────

/** One schema per action, keyed by the field that names it. Extra fields are ignored. */
const ACTIONS = {
  show: z.object({ show: ids, fx: z.enum(['fade', 'pop', 'draw']).optional().catch(undefined) }).transform((a) => ({ type: 'show' as const, ids: a.show, fx: a.fx })),
  hide: z.object({ hide: ids }).transform((a) => ({ type: 'hide' as const, ids: a.hide })),
  focus: z.object({ focus: ids }).transform((a) => ({ type: 'focus' as const, ids: a.focus })),
  highlight: z
    .object({ highlight: ids, color: color.optional() })
    .transform((a) => ({ type: 'highlight' as const, ids: a.highlight, color: a.color ?? 'amber' })),
  pulse: z.object({ pulse: ids }).transform((a) => ({ type: 'pulse' as const, ids: a.pulse })),
  travel: z
    .object({ travel: id, along: z.string(), color: color.optional(), reverse: z.boolean().default(false) })
    .transform((a) => ({ type: 'travel' as const, token: a.travel, along: a.along, color: a.color, reverse: a.reverse })),
}

export type Action = z.output<(typeof ACTIONS)[keyof typeof ACTIONS]>

export function parseAction(raw: unknown): Action {
  const fields = z.record(z.string(), z.unknown()).parse(raw)
  const type = (Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).find((name) => name in fields)
  if (!type) throw new Error(`unknown action ${JSON.stringify(raw).slice(0, 60)}`)
  return ACTIONS[type].parse(fields)
}

export interface Beat {
  board: number
  say: string
  actions: Action[]
  /** Extra seconds to rest after the beat. */
  hold?: number
  /** The recorded narration; its length times the beat. Without it the browser speaks the line. */
  audio?: { url: string; seconds: number }
}

export interface Board {
  title?: string
  layout?: Layout
}

export interface Key {
  el: string
  prop: AnimatedProp
  t: number
  v: number | string
  ease: 'smooth' | 'linear'
}

export interface Cue {
  t: number
  text: string
  /** URL of the recorded line, if any. */
  audio?: string
}

export interface Scene {
  version: typeof SCENE_VERSION
  boards: Board[]
  elements: Element[]
  beats: Beat[]
  /** The voice the beats' audio was recorded with. */
  voice?: string
  /** Keyframes edited in Theatre Studio; when present they replace the ones derived from the beats. */
  keys?: Key[]
  /** Derived from the beats by finalizeScene, kept for the player and transcript. */
  cues: Cue[]
  duration: number
}

// ── Ops ─────────────────────────────────────────────────────────────────────

const BoardSchema = z.object({ title: z.string().optional(), layout: z.enum(LAYOUTS).optional().catch(undefined) })
const BeatSchema = z.object({
  say: z.string().min(1),
  do: z.array(z.unknown()).default([]),
  hold: z.number().min(0).max(10).optional(),
})

export type SceneOp =
  | ({ op: 'board' } & z.infer<typeof BoardSchema>)
  | { op: 'el'; element: z.infer<typeof ElementSchema> }
  | { op: 'link'; link: z.infer<typeof LinkSchema> }
  | ({ op: 'beat' } & z.infer<typeof BeatSchema>)
  | { op: 'ignore' }

export function parseOp(raw: unknown): SceneOp {
  const { op, ...rest } = z.object({ op: z.string() }).passthrough().parse(raw)
  switch (op) {
    case 'board':
      return { op, ...BoardSchema.parse(rest) }
    case 'el':
    case 'box':
    case 'circle':
    case 'icon':
    case 'text': {
      // Models use the kind as the op, invent kinds, and declare links as elements.
      const kind = normalizeKind(op === 'el' ? rest.kind : op, rest)
      if (kind === 'link') return { op: 'link', link: LinkSchema.parse(rest) }
      return { op: 'el', element: ElementSchema.parse(normalizeFields(kind, rest)) }
    }
    case 'link':
      return { op, link: LinkSchema.parse(rest) }
    case 'beat':
      return { op, ...BeatSchema.parse(rest) }
    case 'scene':
      return { op: 'ignore' } // a harmless habit from earlier formats
    default:
      throw new Error(`unknown op "${op}"`)
  }
}

const KINDS = ['box', 'circle', 'icon', 'text', 'dot', 'illustration', 'chart', 'counter', 'timeline', 'table', 'group']

const KIND_ALIASES: Record<string, string> = {
  rect: 'box',
  rectangle: 'box',
  square: 'box',
  card: 'box',
  node: 'box',
  step: 'box',
  block: 'box',
  shape: 'box',
  ellipse: 'circle',
  oval: 'circle',
  symbol: 'icon',
  emoji: 'icon',
  image: 'illustration',
  picture: 'illustration',
  drawing: 'illustration',
  art: 'illustration',
  graph: 'chart',
  'bar-chart': 'chart',
  bars: 'chart',
  number: 'counter',
  stat: 'counter',
  statistic: 'counter',
  history: 'timeline',
  events: 'timeline',
  matrix: 'table',
  grid: 'table',
  container: 'group',
  frame: 'group',
  area: 'group',
  region: 'group',
  label: 'text',
  note: 'text',
  caption: 'text',
  formula: 'text',
  equation: 'text',
  title: 'text',
  arrow: 'link',
  edge: 'link',
  line: 'link',
  connector: 'link',
}

/** Maps an element kind a model wrote onto one the stage knows; anything unrecognisable becomes a box. */
function normalizeKind(kind: unknown, fields: Record<string, unknown>): string {
  const name = String(kind ?? '').toLowerCase()
  if (name === 'link' || ((KIND_ALIASES[name] === 'link' || !name) && 'from' in fields && 'to' in fields)) return 'link'
  if (KINDS.includes(name)) return name
  const alias = KIND_ALIASES[name]
  if (alias && alias !== 'link') return alias
  return 'text' in fields && !('label' in fields) ? 'text' : 'box'
}

/**
 * Accepts the field names models reach for (data, values, events, headers) and turns a drawing
 * that does not exist into the matching icon, or a labelled box, rather than losing it.
 */
function normalizeFields(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  const pick = (...names: string[]) => names.map((name) => fields[name]).find((value) => value !== undefined)
  switch (kind) {
    case 'illustration': {
      const art = String(pick('art', 'name', 'src', 'icon') ?? '')
      if (art in ILLUSTRATIONS) return { ...fields, kind, art }
      const label = fields.label ?? art.replace(/[-_]+/g, ' ')
      return art in ICONS ? { ...fields, kind: 'icon', icon: art, label, size: 96 } : { ...fields, kind: 'box', label }
    }
    case 'chart':
      return { ...fields, kind, bars: pick('bars', 'data', 'values', 'items') }
    case 'timeline':
      return { ...fields, kind, points: pick('points', 'events', 'items', 'moments') }
    case 'table':
      return { ...fields, kind, columns: pick('columns', 'headers', 'header', 'cols'), rows: pick('rows', 'data', 'cells') }
    case 'group':
      return { ...fields, kind, contains: pick('contains', 'members', 'children', 'items', 'ids') }
    default:
      return { ...fields, kind }
  }
}

export function describeError(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((i) => `${i.path.join('.') || 'line'}: ${i.message}`).join('; ')
  return error instanceof Error ? error.message : String(error)
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
