// Turns a storyboard into placed elements and keyframes.
// Timing comes from the narration: a beat lasts as long as its sentence takes to say (or its
// animations take to play), and its actions are spread across that time. Boards replace each
// other, and anything the AI forgot to show is shown when it becomes relevant, so nothing
// declared is ever missing from the screen.

import { linkGeometry, placedGroup, type Placed } from './geometry'
import { photoSize, spotIn } from './images'
import { layoutBoard, type Placement } from './layout'
import { tabIndex } from './widgets'
import { MARKER_BACKGROUND, THEME, toHex } from './palette'
import { stageOf, type Action, type ElementOf, type AnimatedProp, type Beat, type Cue, type ElementKind, type Key, type Scene, type SceneElement, type StageFrame, type Visual } from './schema'

export interface Resolved {
  /** The stage's size and safe area, from the scene's format. */
  stage: StageFrame
  duration: number
  background: string
  /** Text and label colours, when they differ from the default dark-stage ones (brand.ts). */
  ink?: { text: string; label: string }
  /** Labels hand-lettered in capitals (the marker look). */
  hand?: boolean
  /** A logo in the stage's corner (brand.ts). */
  logo?: string
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
const DURATION = { fade: 0.6, pop: 0.6, hide: 0.5, highlight: 0.4, pulse: 0.8, focus: 0.4, travel: 1.6, move: 0.8, zoom: 1.4, fill: 1.4, tab: 0.5 }
/** Elements that draw themselves in (`draw` 0..1), and how long that takes. Photos do when sketched. */
const DRAW_TIME: Partial<Record<ElementKind, number>> = { link: 0.9, illustration: 2.4, chart: 1.4, counter: 1.6, timeline: 1.6, table: 1.2, photo: 2.8, chain: 1.8 }
/** How far a zoom moves in, unless the AI says. */
const ZOOM = 2.4
const TRAVEL_SAMPLES = 12

export const titleId = (board: number) => `title-${board + 1}`
export const speechSeconds = (text: string) => text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND

const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2)

export function compile(scene: Scene): Resolved {
  const stage = stageOf(scene.format)
  const { elements, positions } = place(scene, stage)
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

      case 'zoom': {
        const photo = byId.get(action.ids[0])
        const home = photo && positions.get(photo.id)?.get(board)
        if (photo?.kind !== 'photo' || !home) return 0
        const at = action.spot ? spotIn(photo, action.spot, elements) : undefined
        if (action.spot && !at) return 0
        // In: the place moves to the middle of the stage, the photo grows around it. Out: back to its place.
        const { w, h } = photoSize(photo)
        const scale = at ? home.scale * (action.scale ?? ZOOM) : home.scale
        const centre = { x: (stage.safe.x0 + stage.safe.x1) / 2, y: (stage.safe.y0 + stage.safe.y1) / 2 }
        // Centred on the place, but a photo larger than the stage keeps covering it rather than leave a strip.
        const cover = (wanted: number, size: number, stageSize: number, over = 12) =>
          size >= stageSize + over * 2 ? Math.min(size / 2 - over, Math.max(stageSize + over - size / 2, wanted)) : wanted
        const target = at
          ? {
              x: cover(centre.x - (at[0] - 0.5) * w * scale, w * scale, stage.width),
              y: cover(centre.y - (at[1] - 0.5) * h * scale, h * scale, stage.height),
            }
          : home
        const d = DURATION.zoom
        tween(photo.id, 'x', t, t + d, round(target.x))
        tween(photo.id, 'y', t, t + d, round(target.y))
        tween(photo.id, 'scale', t, t + d, round(scale))
        // Pins move with the same easing over the same time, so they stay on their place in the picture.
        const pins = pinsOf(photo.id)
        for (const pin of pins) {
          tween(pin.id, 'x', t, t + d, round(target.x + (pin.at![0] - 0.5) * w * scale))
          tween(pin.id, 'y', t, t + d, round(target.y + (pin.at![1] - 0.5) * h * scale))
        }
        // The rest of the board makes way while zoomed in, and comes back on the way out.
        if (at) {
          const own = new Set([photo.id, ...pins.map((pin) => pin.id)])
          for (const id of visible(board)) {
            if (own.has(id)) continue
            tween(id, 'opacity', t, t + DURATION.hide, 0)
            zoomedAway.add(id)
          }
        } else {
          for (const id of zoomedAway) if (state.get(id)!.opacity === 0) tween(id, 'opacity', t + d - DURATION.fade, t + d, 1)
          zoomedAway.clear()
        }
        return d
      }

      case 'fill': {
        const el = byId.get(action.ids[0])
        if (el?.kind !== 'illustration') return 0
        tween(el.id, 'value', t, t + DURATION.fill, action.to)
        return DURATION.fill
      }

      case 'tab': {
        const el = byId.get(action.ids[0])
        if (el?.kind !== 'tabs') return 0
        show(el.id, t)
        tween(el.id, 'value', t, t + DURATION.tab, tabIndex(el, action.to))
        return DURATION.tab
      }
    }
  }

  const pinsOf = (photo: string) => elements.filter((el): el is SceneElement & ElementOf<'pin'> => el.kind === 'pin' && el.on === photo && Boolean(el.at))

  const show = (id: string, t: number, fx?: 'fade' | 'pop' | 'draw') => {
    const el = byId.get(id)
    const current = state.get(id)
    if (!el || !current || current.opacity >= 1) return
    const effect = fx ?? defaultEntrance(el)
    if (effect === 'draw' && drawsIn(el)) {
      key(id, 'draw', t, 0)
      key(id, 'draw', t + DRAW_TIME[el.kind]!, 1)
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
    if (el?.kind === 'group') return placedGroup(el, el.contains.map((id) => placed(byId.get(id))).filter((member): member is Placed => Boolean(member)))
    const s = el && state.get(el.id)
    return el && s ? { el, x: s.x, y: s.y, scale: s.scale } : null
  }

  let t = LEAD_IN
  let board = -1
  const dimmed = new Set<string>()
  /** Hidden while a photo on the board is zoomed in; shown again when it zooms out. */
  const zoomedAway = new Set<string>()

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
      zoomedAway.clear()
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
    stage,
    duration: Math.ceil(t + 0.5),
    background: scene.look === 'marker' ? MARKER_BACKGROUND : THEME.background,
    ...(scene.look === 'marker' && { hand: true }),
    elements,
    keys: scene.keys ?? keys,
    cues,
  }
}

/**
 * Lays out every board and adds its titles. Each element starts hidden at its place on the first
 * board it appears on; `positions` holds its place on every board, for the moves between boards.
 */
function place(scene: Scene, stage: StageFrame): { elements: SceneElement[]; positions: Map<string, Map<number, Placement>> } {
  const positions = new Map<string, Map<number, Placement>>()
  const titles: SceneElement[] = []
  // Notes wrap within the safe area; on a narrow stage that is less than the width the AI asked for.
  const room = stage.safe.x1 - stage.safe.x0
  const fitted = scene.elements.map((el) => (el.kind === 'text' && el.width > room ? { ...el, width: room } : el))
  const placeAt = (id: string, board: number, placement: Placement) => {
    if (!positions.has(id)) positions.set(id, new Map())
    positions.get(id)!.set(board, placement)
  }
  scene.boards.forEach((board, index) => {
    const members = fitted.filter((el) => el.boards.includes(index) && el.kind !== 'pin')
    const placed = layoutBoard(board, members, stage)
    for (const [id, placement] of placed) placeAt(id, index, placement)
    // A pin sits on its place in the photo, wherever the layout put the photo.
    for (const pin of fitted) {
      if (pin.kind !== 'pin' || !pin.at || !pin.boards.includes(index)) continue
      const photo = fitted.find((el) => el.id === pin.on)
      const home = placed.get(pin.on)
      if (photo?.kind !== 'photo' || !home) continue
      const { w, h } = photoSize(photo)
      placeAt(pin.id, index, { x: round(home.x + (pin.at[0] - 0.5) * w * home.scale), y: round(home.y + (pin.at[1] - 0.5) * h * home.scale), scale: 1, curve: 0 })
    }
    if (board.title) {
      titles.push({
        id: titleId(index),
        kind: 'text',
        text: board.title,
        size: 34,
        weight: 700,
        width: stage.titleWidth,
        font: 'sans',
        boards: [index],
        color: THEME.text,
        ...hidden({ x: stage.width / 2, y: stage.titleY, scale: 1, curve: 0 }),
      })
    }
  })

  // Pins are drawn over the photos they mark.
  const ordered = [...fitted.filter((el) => el.kind !== 'pin'), ...fitted.filter((el) => el.kind === 'pin')]
  // A drawing that is filled during the lesson shows its level from the start (empty unless set).
  const filled = new Set(scene.beats.flatMap((beat) => beat.actions.flatMap((action) => (action.type === 'fill' ? action.ids : []))))
  const elements = ordered.map((el): SceneElement => {
    const first = positions.get(el.id)?.get(Math.min(...el.boards))
    const shown = { ...el, ...hidden(first ?? { x: stage.width / 2, y: stage.height / 2, scale: 1, curve: 0 }) }
    if (el.kind === 'illustration' && (el.level !== undefined || filled.has(el.id))) return { ...shown, level: el.level ?? 0, value: el.level ?? 0 } as SceneElement
    if (el.kind === 'tabs') return { ...shown, value: tabIndex(el, el.current) }
    return shown
  })
  return { elements: [...titles, ...elements], positions }
}

const hidden = ({ x, y, scale, curve }: Placement) => ({ x, y, scale, curve, rotation: 0, opacity: 0, draw: 1, value: 0 })

/**
 * Beats with an extra "show" for anything the AI put on a board but never showed there: shapes
 * appear at the board's first beat, links once both ends are visible. Boards without beats get a
 * silent one. A show for something already visible (carried over from the previous board) does nothing.
 * Actions on a group apply to its members too.
 */
function withEveryElementShown(scene: Scene): Beat[] {
  const beats: Beat[] = scene.beats.map((beat) => ({ ...beat, actions: beat.actions.map((action) => withGroupMembers(scene, action)) }))
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

const drawsIn = (el: SceneElement) => (el.kind === 'link' ? !el.dashed : el.kind === 'photo' ? el.look === 'sketch' : el.kind in DRAW_TIME)

/** Showing, hiding, focusing or pulsing a group does the same to the shapes inside it. */
function withGroupMembers(scene: Scene, action: Action): Action {
  if (action.type !== 'show' && action.type !== 'hide' && action.type !== 'focus' && action.type !== 'pulse') return action
  const members = (id: string) => {
    const el = scene.elements.find((candidate) => candidate.id === id)
    return el?.kind === 'group' ? el.contains : []
  }
  return { ...action, ids: [...new Set(action.ids.flatMap((id) => [id, ...members(id)]))] }
}

function defaultEntrance(el: SceneElement): 'fade' | 'pop' | 'draw' {
  if (drawsIn(el)) return 'draw'
  return el.kind === 'text' || el.kind === 'dot' || el.kind === 'group' || el.kind === 'link' || el.kind === 'photo' ? 'fade' : 'pop'
}

function entranceTime(el: SceneElement | undefined, fx?: 'fade' | 'pop' | 'draw'): number {
  if (!el) return 0
  return (fx ?? defaultEntrance(el)) === 'draw' && drawsIn(el) ? DRAW_TIME[el.kind]! : DURATION.fade
}

const visualOf = ({ x, y, rotation, scale, opacity, draw, color, value }: SceneElement): Visual => ({ x, y, rotation, scale, opacity, draw, color, value })
const round = (n: number) => Math.round(n * 100) / 100
