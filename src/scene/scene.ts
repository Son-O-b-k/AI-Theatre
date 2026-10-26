import { compile } from './compile'
import { hasShapeLabel, LABEL_SIZE, labelPosition, textWidth } from './geometry'
import { THEME, toHex } from './palette'
import { describeError, parseAction, SCENE_VERSION, type Action, type Element, type ElementKind, type Scene, type SceneOp } from './schema'

type Warn = (message: string) => void

const DEFAULT_COLOR: Record<ElementKind, string> = {
  box: 'blue',
  circle: 'purple',
  icon: 'sky',
  dot: 'amber',
  text: THEME.text,
  link: 'slate',
}

const LABEL_PADDING = 36
const MAX_BOX_WIDTH = 360
const MAX_CIRCLE_RADIUS = 110

export const emptyScene = (): Scene => ({ version: SCENE_VERSION, boards: [], elements: [], beats: [], cues: [], duration: 0 })

/**
 * Applies one streamed op. Models write in a loose order, so this is forgiving:
 * - an element from an earlier board that is mentioned again is carried onto the current board;
 * - a link may arrive before its ends (finalizeScene drops it if they never do);
 * - anything that cannot be used is reported through `warn` and skipped, the rest is kept.
 */
export function applyOp(scene: Scene, op: SceneOp, warn: Warn): Scene {
  // Elements and beats need a board; models sometimes start without one.
  let s: Scene = scene.boards.length > 0 || op.op === 'board' ? scene : { ...scene, boards: [{}] }
  const board = Math.max(0, s.boards.length - 1)

  switch (op.op) {
    case 'ignore':
      return scene

    case 'board':
      return { ...s, boards: [...s.boards, { title: op.title, layout: op.layout }] }

    case 'el': {
      const previous = find(s, op.element.id)
      const boards = previous ? union(previous.boards, board) : [board]
      // Dots are travel tokens. One the AI declares itself is a thing to look at: lay it out as a circle.
      const element = op.element.kind === 'dot' ? { ...op.element, kind: 'circle' as const, r: Math.max(op.element.r, 28) } : op.element
      const color = toHex(element.color ?? DEFAULT_COLOR[element.kind])
      return upsert(s, fitLabel({ ...element, color, boards } as Element))
    }

    case 'link': {
      for (const end of [op.link.from, op.link.to]) s = carry(s, end, board)
      const previous = find(s, op.link.id)
      const boards = previous ? union(previous.boards, board) : [board]
      return upsert(s, { ...op.link, kind: 'link', color: toHex(op.link.color ?? DEFAULT_COLOR.link), boards })
    }

    case 'beat': {
      const actions: Action[] = []
      for (const raw of op.do) {
        let action: Action
        try {
          action = parseAction(raw)
        } catch (error) {
          warn(`action skipped (${describeError(error)})`)
          continue
        }
        if (action.type === 'travel') {
          if (find(s, action.along)?.kind !== 'link') {
            warn(`travel skipped: "${action.along}" is not a link`)
            continue
          }
          s = carry(s, action.along, board)
          // Tokens are created on first use, so the AI does not have to declare them. Travelling a
          // shape (rather than a token) sends a token in that shape's colour instead.
          const named = find(s, action.token)
          const token = named && named.kind !== 'dot' ? `${action.token}-token` : action.token
          const color = action.color ?? (named && named.kind !== 'dot' ? named.color : undefined)
          s = find(s, token)
            ? carry(s, token, board)
            : upsert(s, { id: token, kind: 'dot', r: 10, color: toHex(color ?? DEFAULT_COLOR.dot), boards: [board] })
          actions.push({ ...action, token })
          continue
        }
        for (const id of action.ids) s = find(s, id) ? carry(s, id, board) : standIn(s, id, board, warn)
        actions.push(action)
      }
      return { ...s, beats: [...s.beats, { board, say: op.say, actions, hold: op.hold }] }
    }
  }
}

const find = (scene: Scene, id: string) => scene.elements.find((el) => el.id === id)

/**
 * A box for something the AI used but never declared. The narration usually names it ("cat"),
 * so a labelled box is a better outcome than an empty spot on the board.
 */
function standIn(scene: Scene, id: string, board: number, warn: Warn): Scene {
  warn(`"${id}" was used but never declared; drawn as a box`)
  const label = id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  return upsert(scene, fitLabel({ id, kind: 'box', label, w: 170, h: 110, color: toHex(DEFAULT_COLOR.box), boards: [board] }))
}
const union = (boards: number[], board: number) => (boards.includes(board) ? boards : [...boards, board])

/** Puts an existing element (and, for a link, its ends) on `board` too. */
function carry(scene: Scene, id: string, board: number): Scene {
  const el = find(scene, id)
  if (!el || el.boards.includes(board)) return scene
  let s = upsert(scene, { ...el, boards: [...el.boards, board] })
  if (el.kind === 'link') for (const end of [el.from, el.to]) s = carry(s, end, board)
  return s
}

/** Grows a box or circle so a label written inside it fits. */
function fitLabel(el: Element): Element {
  if (!hasShapeLabel(el) || labelPosition(el) !== 'inside') return el
  const needed = textWidth(el.label!, LABEL_SIZE) + LABEL_PADDING
  if (el.kind === 'box') return { ...el, w: Math.min(MAX_BOX_WIDTH, Math.max(el.w, needed)) }
  if (el.kind === 'circle') return { ...el, r: Math.min(MAX_CIRCLE_RADIUS, Math.max(el.r, needed / 2)) }
  return el
}

function upsert(scene: Scene, element: Element): Scene {
  const index = scene.elements.findIndex((el) => el.id === element.id)
  if (index === -1) return { ...scene, elements: [...scene.elements, element] }
  const elements = [...scene.elements]
  elements[index] = element
  return { ...scene, elements }
}

/**
 * Finishes a streamed scene. Link ends that were never declared get stand-in boxes; a link whose
 * ends ended up on other boards is dropped (with the actions that used it). Then the narration
 * timing and length are derived and stored.
 */
export function finalizeScene(input: Scene, warn: Warn = () => {}): Scene {
  let scene = input
  for (const link of input.elements) {
    if (link.kind !== 'link') continue
    for (const end of [link.from, link.to]) if (!find(scene, end)) scene = standIn(scene, end, link.boards[0], warn)
  }
  const onBoard = (id: string, board: number) => find(scene, id)?.boards.includes(board)
  const dropped = new Set<string>()
  const elements = scene.elements.flatMap((el): Element[] => {
    if (el.kind !== 'link') return [el]
    const boards = el.boards.filter((board) => onBoard(el.from, board) && onBoard(el.to, board))
    if (boards.length === el.boards.length) return [el]
    if (boards.length === 0) {
      warn(`link "${el.id}" dropped: "${el.from}" and "${el.to}" are not on the same board`)
      dropped.add(el.id)
      return []
    }
    return [{ ...el, boards }]
  })
  const beats = scene.beats.map((beat) => ({
    ...beat,
    actions: beat.actions.flatMap((action): Action[] => {
      if (action.type === 'travel') return dropped.has(action.along) ? [] : [action]
      const ids = action.ids.filter((id) => !dropped.has(id))
      return ids.length ? [{ ...action, ids }] : []
    }),
  }))
  const pruned = { ...scene, elements, beats }
  const { cues, duration } = compile(pruned)
  return { ...pruned, cues, duration }
}

/** The inverse of parsing: shows the AI the current scene when refining it. */
export function sceneToLines(scene: Scene): string {
  const lines: unknown[] = []
  scene.boards.forEach((board, index) => {
    lines.push({ op: 'board', ...board })
    // Every element is listed on each board it appears on; repeating a declaration carries it over.
    for (const el of scene.elements.filter((e) => e.boards.includes(index))) {
      if (el.kind === 'dot') continue // created by travel actions
      const { boards: _, ...fields } = el
      lines.push(el.kind === 'link' ? { op: 'link', ...omitKind(fields) } : { op: 'el', ...fields })
    }
    for (const beat of scene.beats.filter((b) => b.board === index)) {
      lines.push({ op: 'beat', say: beat.say, do: beat.actions.map(toWritten), ...(beat.hold && { hold: beat.hold }) })
    }
  })
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

const omitKind = ({ kind: _, ...rest }: { kind: string }) => rest

/** An action in the compact form the AI writes. */
function toWritten(action: Action): Record<string, unknown> {
  const one = (ids: string[]) => (ids.length === 1 ? ids[0] : ids)
  switch (action.type) {
    case 'show':
      return { show: one(action.ids), ...(action.fx && { fx: action.fx }) }
    case 'highlight':
      return { highlight: one(action.ids), color: action.color }
    case 'travel':
      return { travel: action.token, along: action.along, ...(action.color && { color: action.color }), ...(action.reverse && { reverse: true }) }
    default:
      return { [action.type]: one(action.ids) }
  }
}
