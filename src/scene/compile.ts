// Turns a storyboard into placed elements and keyframes.
// Timing comes from the narration: a beat lasts as long as its sentence takes to say (or its
// animations take to play), and its actions are spread across that time. Boards replace each
// other, and anything the AI forgot to show is shown when it becomes relevant, so nothing
// declared is ever missing from the screen.

import { linkGeometry, type Placed } from './geometry'
import { layoutBoard, type Placement } from './layout'
import { THEME, toHex } from './palette'
import { STAGE, TITLE_Y, type Action, type AnimatedProp, type Beat, type Cue, type Key, type Scene, type SceneElement, type Visual } from './schema'

export interface Resolved {
  duration: number
  background: string
  /** Placed elements with their starting values (everything starts hidden). */
  elements: SceneElement[]
  keys: Key[]
  cues: Cue[]
}

export const WORDS_PER_SECOND = 2.5
const LEAD_IN = 0.4
const BOARD_CHANGE = 0.8
const BEAT_GAP = 0.5
const MIN_BEAT = 2.5
const DIMMED = 0.2
const DURATION = { fade: 0.6, pop: 0.6, draw: 0.9, hide: 0.5, highlight: 0.4, pulse: 0.8, focus: 0.4, travel: 1.6, move: 0.8 }
const TRAVEL_SAMPLES = 12

export const titleId = (board: number) => `title-${board + 1}`
export const speechSeconds = (text: string) => text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

export function compile(scene: Scene): Resolved {
  const { elements, positions } = place(scene)
  const byId = new Map(elements.map((el) => [el.id, el]))
  const state = new Map(elements.map((el) => [el.id, { ...visualOf(el) }]))
  const keys: Key[] = []
  const cues: Cue[] = []

  const key = (el: string, prop: AnimatedProp, t: number, v: number | string, ease: Key['ease'] = 'smooth') =>
    keys.push({ el, prop, t: Math.max(0, round(t)), v, ease })

  /** Animates a prop from its current value to `to` between t0 and t1. */
  const tween = (el: string, prop: AnimatedProp, t0: number, t1: number, to: number | string, ease?: Key['ease']) => {
    const current = state.get(el)
    if (!current || current[prop] === to) return
    key(el, prop, t0, current[prop], ease)
    key(el, prop, t1, to, ease)
    Object.assign(current, { [prop]: to })
  }

  const visible = (board: number) =>
    elements.filter((el) => el.boards.includes(board) && state.get(el.id)!.opacity > 0 && el.id !== titleId(board)).map((el) => el.id)

  /** Runs one action starting at `t`; returns how long it takes. */
  const run = (action: Action, t: number, board: number): number => {
    switch (action.type) {
      case 'show':
        for (const id of action.ids) show(id, t, action.fx)
        return Math.max(...action.ids.map((id) => entranceTime(byId.get(id), action.fx)))

      case 'hide':
        for (const id of action.ids) tween(id, 'opacity', t, t + DURATION.hide, 0)
        return DURATION.hide

      case 'focus': {
        const focused = new Set(action.ids)
        for (const id of action.ids) show(id, t)
        for (const id of visible(board)) {
          const el = byId.get(id)!
          const touchesFocus = el.kind === 'link' && (focused.has(el.from) || focused.has(el.to))
          if (!focused.has(id) && !touchesFocus) {
            tween(id, 'opacity', t, t + DURATION.focus, DIMMED)
            dimmed.add(id)
          }
        }
        return DURATION.focus
      }

      case 'highlight':
        for (const id of action.ids) tween(id, 'color', t, t + DURATION.highlight, toHex(action.color))
        return DURATION.highlight

      case 'pulse':
        for (const id of action.ids) {
          const scale = state.get(id)?.scale
          if (scale === undefined) continue
          key(id, 'scale', t, scale)
          key(id, 'scale', t + 0.3, scale * 1.18)
          key(id, 'scale', t + DURATION.pulse, scale)
        }
        return DURATION.pulse

      case 'travel': {
        const link = byId.get(action.along)
        const token = state.get(action.token)
        if (link?.kind !== 'link' || !token) return 0
        const from = placed(byId.get(link.from))
        const to = placed(byId.get(link.to))
        if (!from || !to) return 0

        const path = linkGeometry(from, to, link.curve)
        const d = DURATION.travel
        if (action.color) tween(action.token, 'color', t - 0.2, t - 0.15, toHex(action.color))
        tween(action.token, 'opacity', t - 0.15, t, 1)
        for (let i = 0; i <= TRAVEL_SAMPLES; i++) {
          const u = i / TRAVEL_SAMPLES
          const p = path.at(action.reverse ? 1 - easeInOut(u) : easeInOut(u))
          key(action.token, 'x', t + u * d, round(p.x), 'linear')
          key(action.token, 'y', t + u * d, round(p.y), 'linear')
        }
        Object.assign(token, path.at(action.reverse ? 0 : 1))
        tween(action.token, 'opacity', t + d, t + d + 0.2, 0)
        return d + 0.2
      }
    }
  }

  const show = (id: string, t: number, fx?: 'fade' | 'pop' | 'draw') => {
    const el = byId.get(id)
    const current = state.get(id)
    if (!el || !current || current.opacity >= 1) return
    const effect = fx ?? defaultEntrance(el)
    if (effect === 'draw' && el.kind === 'link' && !el.dashed) {
      key(id, 'draw', t, 0)
      key(id, 'draw', t + DURATION.draw, 1)
      tween(id, 'opacity', t, t + 0.15, 1)
      return
    }
    if (effect === 'pop' && current.opacity === 0) {
      key(id, 'scale', t, current.scale * 0.6)
      key(id, 'scale', t + DURATION.pop, current.scale)
    }
    tween(id, 'opacity', t, t + DURATION.fade, 1)
  }

  const placed = (el: SceneElement | undefined): Placed | null => {
    const s = el && state.get(el.id)
    return el && s ? { el, x: s.x, y: s.y, scale: s.scale } : null
  }

  let t = LEAD_IN
  let board = -1
  const dimmed = new Set<string>()

  for (const beat of withEveryElementShown(scene)) {
    if (beat.board !== board) {
      const next = beat.board
      if (board !== -1) {
        // What the next board keeps glides to its new place; everything else leaves.
        for (const id of visible(board)) {
          const target = positions.get(id)?.get(next)
          if (!target) {
            tween(id, 'opacity', t, t + DURATION.hide, 0)
            continue
          }
          tween(id, 'x', t, t + DURATION.move, target.x)
          tween(id, 'y', t, t + DURATION.move, target.y)
          tween(id, 'scale', t, t + DURATION.move, target.scale)
          tween(id, 'opacity', t, t + DURATION.move, 1)
        }
        tween(titleId(board), 'opacity', t, t + DURATION.hide, 0)
        t += BOARD_CHANGE
      }
      // Off-screen members of the next board wait at their place there, ready to appear.
      for (const [id, byBoard] of positions) {
        const target = byBoard.get(next)
        const current = state.get(id)!
        if (!target || current.opacity > 0) continue
        for (const prop of ['x', 'y', 'scale'] as const) tween(id, prop, t - 0.02, t, target[prop])
      }
      board = next
      dimmed.clear()
      tween(titleId(board), 'opacity', t, t + DURATION.fade, 1)
    } else if (dimmed.size > 0) {
      for (const id of dimmed) if (state.get(id)!.opacity === DIMMED) tween(id, 'opacity', t, t + DURATION.focus, 1)
      dimmed.clear()
    }

    const speech = beat.audio?.seconds ?? speechSeconds(beat.say)
    const stagger = beat.actions.length > 1 ? Math.min(1, Math.max(0.3, speech / (beat.actions.length + 1))) : 0
    let end = t + Math.max(speech, MIN_BEAT)
    beat.actions.forEach((action, i) => {
      const at = t + i * stagger
      end = Math.max(end, at + run(action, at, board))
    })
    if (beat.say) cues.push({ t: round(t), text: beat.say, ...(beat.audio && { audio: beat.audio.url }) })
    t = end + BEAT_GAP + (beat.hold ?? 0)
  }

  return {
    duration: Math.ceil(t + 0.5),
    background: THEME.background,
    elements,
    keys: scene.keys ?? keys,
    cues,
  }
}

/**
 * Lays out every board and adds its titles. Each element starts hidden at its place on the first
 * board it appears on; `positions` holds its place on every board, for the moves between boards.
 */
function place(scene: Scene): { elements: SceneElement[]; positions: Map<string, Map<number, Placement>> } {
  const positions = new Map<string, Map<number, Placement>>()
  const titles: SceneElement[] = []
  scene.boards.forEach((board, index) => {
    const members = scene.elements.filter((el) => el.boards.includes(index))
    for (const [id, placement] of layoutBoard(board, members)) {
      if (!positions.has(id)) positions.set(id, new Map())
      positions.get(id)!.set(index, placement)
    }
    if (board.title) {
      titles.push({
        id: titleId(index),
        kind: 'text',
        text: board.title,
        size: 34,
        weight: 700,
        width: 1100,
        boards: [index],
        color: THEME.text,
        ...hidden({ x: STAGE.width / 2, y: TITLE_Y, scale: 1, curve: 0 }),
      })
    }
  })

  const elements = scene.elements.map((el): SceneElement => {
    const first = positions.get(el.id)?.get(Math.min(...el.boards))
    return { ...el, ...hidden(first ?? { x: STAGE.width / 2, y: STAGE.height / 2, scale: 1, curve: 0 }) }
  })
  return { elements: [...titles, ...elements], positions }
}

const hidden = ({ x, y, scale, curve }: Placement) => ({ x, y, scale, curve, rotation: 0, opacity: 0, draw: 1 })

/**
 * Beats with an extra "show" for anything the AI put on a board but never showed there: shapes
 * appear at the board's first beat, links once both ends are visible. Boards without beats get a
 * silent one. A show for something already visible (carried over from the previous board) does nothing.
 */
function withEveryElementShown(scene: Scene): Beat[] {
  const beats: Beat[] = scene.beats.map((beat) => ({ ...beat, actions: [...beat.actions] }))
  scene.boards.forEach((_, board) => {
    if (scene.elements.some((el) => el.boards.includes(board)) && !beats.some((beat) => beat.board === board)) {
      const at = beats.findIndex((beat) => beat.board > board)
      beats.splice(at === -1 ? beats.length : at, 0, { board, say: '', actions: [] })
    }
  })

  scene.boards.forEach((_, board) => {
    const indices = beats.flatMap((beat, i) => (beat.board === board ? [i] : []))
    if (indices.length === 0) return
    const shownAt = new Map<string, number>()
    for (const i of indices) {
      for (const action of beats[i].actions) {
        const ids = action.type === 'travel' ? [action.token] : action.type === 'show' || action.type === 'focus' ? action.ids : []
        for (const id of ids) if (!shownAt.has(id)) shownAt.set(id, i)
      }
    }
    const members = scene.elements.filter((el) => el.boards.includes(board))
    for (const el of members) {
      if (shownAt.has(el.id) || el.kind === 'link' || el.kind === 'dot') continue
      beats[indices[0]].actions.unshift({ type: 'show', ids: [el.id], fx: undefined })
      shownAt.set(el.id, indices[0])
    }
    for (const el of members) {
      if (shownAt.has(el.id) || el.kind !== 'link') continue
      const ends = [shownAt.get(el.from), shownAt.get(el.to)]
      if (ends.every((i) => i !== undefined)) beats[Math.max(...(ends as number[]))].actions.push({ type: 'show', ids: [el.id], fx: undefined })
    }
  })
  return beats
}

function defaultEntrance(el: SceneElement): 'fade' | 'pop' | 'draw' {
  if (el.kind === 'link') return el.dashed ? 'fade' : 'draw'
  return el.kind === 'text' || el.kind === 'dot' ? 'fade' : 'pop'
}

function entranceTime(el: SceneElement | undefined, fx?: 'fade' | 'pop' | 'draw'): number {
  if (!el) return 0
  return (fx ?? defaultEntrance(el)) === 'draw' ? DURATION.draw : DURATION.fade
}

const visualOf = ({ x, y, rotation, scale, opacity, draw, color }: SceneElement): Visual => ({ x, y, rotation, scale, opacity, draw, color })
const round = (n: number) => Math.round(n * 100) / 100
