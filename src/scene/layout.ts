// Places every element of a board. The AI only says what exists, how it connects and which
// layout fits (row, column, grid, flow, cycle); this module decides where things go, so shapes
// cannot overlap or leave the stage whatever the model writes.
//
// Shapes sit on a uniform grid of cells sized to the largest shape (labels included), which keeps
// boards tidy and aligned. The arrangement is scaled to fit the safe area. Text notes stack under
// the diagram. Links are bent around any shape they would otherwise cross.

import { bounds, LINK_LABEL_SIZE, linkGeometry, textWidth, type Placed, type Rect } from './geometry'
import { SAFE, STAGE, type Board, type Element, type ElementOf, type Layout } from './schema'

export interface Placement {
  x: number
  y: number
  scale: number
  curve: number
}

/**
 * Space between shapes. Boards with links get more, chosen so that even at MIN_COMFORTABLE_SCALE
 * an arrow between neighbours is at least MIN_LINK long once both ends are clipped.
 */
const GAP = { x: 56, y: 44 }
const LINKED_GAP = { x: 110, y: 104 }
export const MIN_LINK = 56
const NOTE_GAP = 14
const MAX_SCALE = 1.5
/** Rows and columns wrap only when keeping them in one line would shrink shapes below this. */
const MIN_COMFORTABLE_SCALE = 0.7
const LINK_CURVES = [0, -0.35, 0.35, -0.6, 0.6, -0.9, 0.9, -1.3, 1.3, -1.8, 1.8]
const LINK_CLEARANCE = 8

interface Cell {
  col: number
  row: number
}

export function layoutBoard(board: Board, elements: Element[]): Map<string, Placement> {
  const placements = new Map<string, Placement>()
  const region: Rect = { x0: SAFE.x0, x1: SAFE.x1, y0: board.title ? SAFE.y0 : 60, y1: SAFE.y1 }
  const shapes = elements.filter((el) => el.kind !== 'link' && el.kind !== 'dot' && el.kind !== 'text')
  const notes = elements.filter((el): el is ElementOf<'text'> => el.kind === 'text')
  const links = elements.filter((el): el is ElementOf<'link'> => el.kind === 'link')

  // A flow needs links between the shapes; without any it would stack everything in one column.
  const members = new Set(shapes.map((shape) => shape.id))
  const connected = links.some((link) => members.has(link.from) && members.has(link.to))
  const layout = board.layout === 'flow' && !connected ? 'row' : (board.layout ?? (connected ? 'flow' : 'row'))

  const diagram = placeNotes(notes, region, shapes.length > 0, placements)
  if (shapes.length > 0) placeShapes(shapes, links, layout, diagram, placements)

  // Tokens are moved by their travel animations; until then they wait at the centre.
  for (const el of elements) {
    if (el.kind === 'dot') placements.set(el.id, { x: STAGE.width / 2, y: (region.y0 + region.y1) / 2, scale: 1, curve: 0 })
  }
  routeLinks(links, shapes, placements)
  return placements
}

/** Stacks notes at the bottom of the region (or centred when they are all there is); returns what is left. */
function placeNotes(notes: ElementOf<'text'>[], region: Rect, belowDiagram: boolean, placements: Map<string, Placement>): Rect {
  if (notes.length === 0) return region
  const sizes = notes.map(measure)
  const height = sizes.reduce((sum, size) => sum + size.height, 0) + NOTE_GAP * (notes.length - 1)
  let y = belowDiagram ? region.y1 - height : (region.y0 + region.y1 - height) / 2
  notes.forEach((note, i) => {
    const size = sizes[i]
    placements.set(note.id, { x: STAGE.width / 2 - size.cx, y: y + size.height / 2 - size.cy, scale: 1, curve: 0 })
    y += size.height + NOTE_GAP
  })
  return belowDiagram ? { ...region, y1: region.y1 - height - GAP.y } : region
}

function placeShapes(shapes: Element[], links: ElementOf<'link'>[], layout: Layout, area: Rect, placements: Map<string, Placement>): void {
  // Linked shapes need room for an arrow and for the longest link label beside it.
  const labelRoom = Math.max(0, ...links.map((link) => (link.label ? textWidth(link.label, LINK_LABEL_SIZE) + 40 : 0)))
  const gap = links.length > 0 ? { x: Math.max(LINKED_GAP.x, labelRoom), y: LINKED_GAP.y } : GAP
  const sizes = shapes.map(measure)
  const cellW = Math.max(...sizes.map((size) => size.width))
  const cellH = Math.max(...sizes.map((size) => size.height))
  const width = area.x1 - area.x0
  const height = area.y1 - area.y0
  const centre = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }

  if (layout === 'cycle' && shapes.length > 2) {
    placeCycle(shapes, sizes, cellW, cellH, width, height, centre, gap, placements)
    return
  }

  const cells = arrange(layout, shapes, links, cellW, cellH, width, height, gap)
  const cols = Math.max(...cells.map((cell) => cell.col)) + 1
  const rows = Math.max(...cells.map((cell) => cell.row)) - Math.min(...cells.map((cell) => cell.row)) + 1
  const spanW = cols * cellW + (cols - 1) * gap.x
  const spanH = rows * cellH + (rows - 1) * gap.y
  const scale = Math.min(MAX_SCALE, width / spanW, height / spanH)
  const midCol = (cols - 1) / 2
  const midRow = (Math.max(...cells.map((cell) => cell.row)) + Math.min(...cells.map((cell) => cell.row))) / 2

  shapes.forEach((shape, i) => {
    const cell = cells[i]
    const x = centre.x + (cell.col - midCol) * (cellW + gap.x) * scale
    const y = centre.y + (cell.row - midRow) * (cellH + gap.y) * scale
    placements.set(shape.id, { x: x - sizes[i].cx * scale, y: y - sizes[i].cy * scale, scale, curve: 0 })
  })
}

/** Grid cells for each shape, in declaration order. */
function arrange(
  layout: Layout,
  shapes: Element[],
  links: ElementOf<'link'>[],
  cellW: number,
  cellH: number,
  width: number,
  height: number,
  gap: typeof GAP,
): Cell[] {
  const n = shapes.length
  if (layout === 'flow') return flowCells(shapes, links)

  const scaleFor = (cols: number) => {
    const rows = Math.ceil(n / cols)
    return Math.min(width / (cols * cellW + (cols - 1) * gap.x), height / (rows * cellH + (rows - 1) * gap.y))
  }
  let cols = 1
  if (layout === 'row' && scaleFor(n) >= MIN_COMFORTABLE_SCALE) cols = n
  else if (layout === 'column' && scaleFor(1) >= MIN_COMFORTABLE_SCALE) cols = 1
  else for (let c = 1; c <= n; c++) if (scaleFor(c) > scaleFor(cols) + 1e-6) cols = c

  // Fill rows left to right; a shorter last row is centred.
  return shapes.map((_, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols)
    return { col: (i % cols) + (cols - inRow) / 2, row }
  })
}

/** Left-to-right layers along the links (longest path from the sources); cycles are broken. */
function flowCells(shapes: Element[], links: ElementOf<'link'>[]): Cell[] {
  const ids = shapes.map((shape) => shape.id)
  const next = new Map(ids.map((id) => [id, [] as string[]]))
  for (const link of links) {
    if (link.from !== link.to && next.has(link.from) && next.has(link.to)) next.get(link.from)!.push(link.to)
  }

  // Drop edges that point back into the current DFS path, so the graph becomes acyclic.
  const state = new Map<string, 'open' | 'done'>()
  const forward = new Map(ids.map((id) => [id, [] as string[]]))
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const to of next.get(id)!) {
      if (state.get(to) === 'open') continue
      forward.get(id)!.push(to)
      if (!state.has(to)) visit(to)
    }
    state.set(id, 'done')
  }
  ids.forEach((id) => state.has(id) || visit(id))

  const layer = new Map(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    for (const [from, tos] of forward) for (const to of tos) layer.set(to, Math.max(layer.get(to)!, layer.get(from)! + 1))
  }

  const counts = new Map<number, number>()
  const indexInLayer = ids.map((id) => {
    const l = layer.get(id)!
    const index = counts.get(l) ?? 0
    counts.set(l, index + 1)
    return index
  })
  return ids.map((id, i) => {
    const l = layer.get(id)!
    return { col: l, row: indexInLayer[i] - (counts.get(l)! - 1) / 2 }
  })
}

function placeCycle(
  shapes: Element[],
  sizes: Size[],
  cellW: number,
  cellH: number,
  width: number,
  height: number,
  centre: { x: number; y: number },
  gap: typeof GAP,
  placements: Map<string, Placement>,
): void {
  const n = shapes.length
  const needed = Math.max(cellW, cellH) + gap.x
  const fit = (scale: number) => ({
    rx: Math.min((width - cellW * scale) / 2, ((height - cellH * scale) / 2) * 1.8),
    ry: (height - cellH * scale) / 2,
  })
  // Shrink until neighbours on the ring are far enough apart.
  let scale = Math.min(MAX_SCALE, width / (cellW * 3), height / (cellH * 2.5))
  for (let i = 0; i < 20; i++) {
    const { rx, ry } = fit(scale)
    const chord = 2 * Math.min(rx, ry) * Math.sin(Math.PI / n)
    if (chord >= needed * scale) break
    scale *= 0.92
  }
  const { rx, ry } = fit(scale)
  shapes.forEach((shape, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n // start at the top, go clockwise
    const x = centre.x + rx * Math.cos(angle)
    const y = centre.y + ry * Math.sin(angle)
    placements.set(shape.id, { x: x - sizes[i].cx * scale, y: y - sizes[i].cy * scale, scale, curve: 0 })
  })
}

/** Bends each link just enough to clear every shape other than its two ends. */
function routeLinks(links: ElementOf<'link'>[], shapes: Element[], placements: Map<string, Placement>): void {
  const placed = (el: Element): Placed => ({ el, ...placements.get(el.id)! })
  const byId = new Map(shapes.map((shape) => [shape.id, shape]))

  for (const link of links) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (!from || !to || !placements.has(from.id) || !placements.has(to.id)) continue
    const obstacles = shapes
      .filter((shape) => shape !== from && shape !== to && placements.has(shape.id))
      .map((shape) => bounds(placed(shape))!)
    // A link and its reverse would draw on top of each other; start them bent apart.
    const reverse = links.some((other) => other.from === link.to && other.to === link.from)
    const candidates = reverse ? LINK_CURVES.filter((curve) => curve !== 0) : LINK_CURVES

    let best = { curve: candidates[0], hits: Infinity }
    for (const curve of candidates) {
      const hits = crossings(linkGeometry(placed(from), placed(to), curve), obstacles)
      if (hits < best.hits) best = { curve, hits }
      if (hits === 0) break
    }
    placements.set(link.id, { x: 0, y: 0, scale: 1, curve: best.curve })
  }
}

/** How many sampled points of a link fall inside (or right next to) any of the obstacles. */
export function crossings(path: ReturnType<typeof linkGeometry>, obstacles: Rect[]): number {
  let hits = 0
  for (let u = 0.04; u <= 0.96; u += 0.04) {
    const p = path.at(u)
    for (const r of obstacles) {
      if (p.x > r.x0 - LINK_CLEARANCE && p.x < r.x1 + LINK_CLEARANCE && p.y > r.y0 - LINK_CLEARANCE && p.y < r.y1 + LINK_CLEARANCE) hits++
    }
  }
  return hits
}

interface Size {
  width: number
  height: number
  /** Offset of the bounding box centre from the element's origin (labels make shapes lopsided). */
  cx: number
  cy: number
}

function measure(el: Element): Size {
  const rect = bounds({ el, x: 0, y: 0, scale: 1 }) ?? { x0: -40, y0: -40, x1: 40, y1: 40 }
  return { width: rect.x1 - rect.x0, height: rect.y1 - rect.y0, cx: (rect.x0 + rect.x1) / 2, cy: (rect.y0 + rect.y1) / 2 }
}
