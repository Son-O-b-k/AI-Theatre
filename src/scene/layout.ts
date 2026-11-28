// Places every element of a board. The AI only says what exists, how it connects and which
// layout fits (row, column, grid, flow, cycle, tree), or where shapes are relative to each other
// ("below" the directory, "left_of" the server); this module decides where things go, so shapes
// cannot overlap or leave the stage whatever the model writes.
//
// Relative placement builds a tree: each shape hangs off the shape it is placed against, and the
// shapes on one side of a shape line up beside each other, centred on it, with whole branches kept
// apart. A tree layout derives the same from the links, top down. Shapes that are not placed
// against anything stand side by side.
//
// Shapes sit on a uniform grid of cells sized to the largest shape (labels included), which keeps
// boards tidy and aligned. The arrangement is scaled to fit the safe area. Text notes stack under
// the diagram. Links are bent around any shape they would otherwise cross. A group is arranged on
// its own first (its members in a small grid, with room for its frame and label) and then takes
// one cell like any shape.

import { bounds, LINK_LABEL_SIZE, linkGeometry, placedGroup, type Placed, type Rect } from './geometry'
import { SIDES, STAGES, type Board, type Element, type ElementOf, type Layout, type Side, type StageFrame } from './schema'
import { textWidth } from './text'
import { GROUP } from './widgets'

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

export function layoutBoard(board: Board, elements: Element[], stage: StageFrame = STAGES.landscape): Map<string, Placement> {
  const placements = new Map<string, Placement>()
  const { safe } = stage
  const region: Rect = { x0: safe.x0, x1: safe.x1, y0: board.title ? safe.y0 : 60, y1: safe.y1 }
  const shapes = elements.filter((el) => el.kind !== 'link' && el.kind !== 'dot' && el.kind !== 'text' && el.kind !== 'group')
  const notes = elements.filter((el): el is ElementOf<'text'> => el.kind === 'text')
  const links = elements.filter((el): el is ElementOf<'link'> => el.kind === 'link')

  // Each shape belongs to at most one group on a board; grouped shapes are placed with their group.
  const groupOf = new Map<string, string>()
  const blocks = new Map<string, Block>()
  for (const group of elements) {
    if (group.kind !== 'group') continue
    const members = shapes.filter((shape) => group.contains.includes(shape.id) && !groupOf.has(shape.id))
    if (members.length === 0) continue
    members.forEach((member) => groupOf.set(member.id, group.id))
    blocks.set(group.id, arrangeGroup(members, links, relations(members, links, false, (id) => id)))
  }
  const isPlaced = new Set([...shapes.map((shape) => shape.id), ...blocks.keys()])
  const top = elements.filter((el) => isPlaced.has(el.id) && !groupOf.has(el.id))
  const outer = (id: string) => groupOf.get(id) ?? id
  const topLinks = links
    .map((link) => ({ ...link, from: outer(link.from), to: outer(link.to) }))
    .filter((link) => link.from !== link.to)

  // A flow needs links between the shapes; without any it would stack everything in one column.
  const members = new Set(top.map((shape) => shape.id))
  const connected = topLinks.some((link) => members.has(link.from) && members.has(link.to))
  const layout = board.layout === 'flow' && !connected ? 'row' : (board.layout ?? (connected ? 'flow' : 'row'))

  const diagram = placeNotes(notes, region, top.length > 0, placements)
  const placed = relations(top, topLinks, board.layout === 'tree' && connected, outer)
  if (top.length > 0 && placed.size > 0) placeRelative(top, placed, topLinks, layout, diagram, placements, blocks)
  else if (top.length > 0) placeShapes(top, topLinks, layout === 'tree' ? 'row' : layout, diagram, placements, blocks)
  for (const [id, block] of blocks) {
    const group = placements.get(id)!
    for (const [member, offset] of block.offsets) {
      placements.set(member, { x: group.x + offset.x * group.scale, y: group.y + offset.y * group.scale, scale: group.scale, curve: 0 })
    }
  }

  // Tokens are moved by their travel animations; until then they wait at the centre.
  for (const el of elements) {
    if (el.kind === 'dot') placements.set(el.id, { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2, scale: 1, curve: 0 })
  }
  routeLinks(links, shapes, elements.filter((el): el is ElementOf<'group'> => el.kind === 'group'), placements)
  return placements
}

/** A group's members arranged around the group's centre, and the room the group takes. */
interface Block {
  size: Size
  offsets: Map<string, { x: number; y: number }>
}

function arrangeGroup(members: Element[], links: ElementOf<'link'>[], placed: Map<string, Place>): Block {
  const ids = new Set(members.map((member) => member.id))
  const gap = links.some((link) => ids.has(link.from) && ids.has(link.to)) ? LINKED_GAP : GAP
  if (placed.size > 0) {
    const sizes = new Map(members.map((member) => [member.id, measure(member)]))
    const { centres, box } = arrangeRelative(members.map((member) => member.id), sizes, placed, gap, 'row')
    const offsets = new Map<string, { x: number; y: number }>()
    for (const [id, centre] of centres) {
      const size = sizes.get(id)!
      offsets.set(id, { x: centre.x - size.cx, y: centre.y - size.cy + GROUP.label / 2 })
    }
    return { size: { width: box.x1 - box.x0 + GROUP.pad * 2, height: box.y1 - box.y0 + GROUP.pad * 2 + GROUP.label, cx: 0, cy: 0 }, offsets }
  }
  const sizes = members.map(measure)
  const cellW = Math.max(...sizes.map((size) => size.width))
  const cellH = Math.max(...sizes.map((size) => size.height))
  const n = members.length
  const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const innerW = cols * cellW + (cols - 1) * gap.x
  const innerH = rows * cellH + (rows - 1) * gap.y
  const offsets = new Map<string, { x: number; y: number }>()
  members.forEach((member, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols)
    const col = (i % cols) + (cols - inRow) / 2
    offsets.set(member.id, {
      x: -innerW / 2 + col * (cellW + gap.x) + cellW / 2 - sizes[i].cx,
      // The label band sits above the members, so they sit half of it lower than the block's centre.
      y: -innerH / 2 + row * (cellH + gap.y) + cellH / 2 - sizes[i].cy + GROUP.label / 2,
    })
  })
  return { size: { width: innerW + GROUP.pad * 2, height: innerH + GROUP.pad * 2 + GROUP.label, cx: 0, cy: 0 }, offsets }
}

// ── Relative placement ──────────────────────────────────────────────────────

interface Place {
  side: Side
  of: string
}

/**
 * Which shape each shape is placed against, among `shapes` only. Places against a shape inside a
 * group count as against the group. A tree takes "below" from the links where nothing else is said.
 * Circular places ("a below b", "b below a") are dropped.
 */
function relations(shapes: Element[], links: ElementOf<'link'>[], fromLinks: boolean, outer: (id: string) => string): Map<string, Place> {
  const ids = new Set(shapes.map((shape) => shape.id))
  const placed = new Map<string, Place>()
  for (const shape of shapes) {
    const place = 'place' in shape ? shape.place : undefined
    if (!place) continue
    const of = outer(place.of)
    if (of !== shape.id && ids.has(of)) placed.set(shape.id, { side: place.side, of })
  }
  if (fromLinks) {
    for (const link of links) {
      if (ids.has(link.from) && ids.has(link.to) && !placed.has(link.to) && link.from !== link.to) placed.set(link.to, { side: 'below', of: link.from })
    }
  }
  for (const id of [...placed.keys()]) {
    const seen = new Set<string>()
    for (let at = placed.get(id)?.of; at !== undefined; at = placed.get(at)?.of) {
      if (at === id) {
        placed.delete(id)
        break
      }
      if (seen.has(at)) break
      seen.add(at)
    }
  }
  return placed
}

const OUTWARD: Record<Side, { x: number; y: number }> = { below: { x: 0, y: 1 }, above: { x: 0, y: -1 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 } }
/** The least room between linked shapes on the stage: an arrow of MIN_LINK plus where it is clipped. */
const READABLE_GAP = MIN_LINK + 24
/** Branches never come closer than this, even where their gaps do not apply. */
const BRANCH_MARGIN = 28

const shift = (r: Rect, dx: number, dy: number): Rect => ({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy })
const union = (rects: Rect[]): Rect => ({
  x0: Math.min(...rects.map((r) => r.x0)),
  y0: Math.min(...rects.map((r) => r.y0)),
  x1: Math.max(...rects.map((r) => r.x1)),
  y1: Math.max(...rects.map((r) => r.y1)),
})
const near = (a: Rect, b: Rect, margin: number) => a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin

interface Branch {
  /** Centre of each shape's box (label included), relative to the branch's own shape. */
  centres: Map<string, { x: number; y: number }>
  /** Every box in the branch, in the same coordinates. */
  boxes: Rect[]
  box: Rect
}

/**
 * Lays shapes out by their places, in unscaled stage units centred on the arrangement's middle.
 * Shapes placed against nothing stand in a row (or a column), each with its branch.
 */
function arrangeRelative(
  ids: string[],
  sizes: Map<string, Size>,
  placed: Map<string, Place>,
  gap: typeof GAP,
  roots: 'row' | 'column',
): { centres: Map<string, { x: number; y: number }>; box: Rect } {
  const children = new Map<string, Record<Side, string[]>>()
  for (const id of ids) {
    const place = placed.get(id)
    if (!place) continue
    const sides = children.get(place.of) ?? { below: [], above: [], left: [], right: [] }
    sides[place.side].push(id)
    children.set(place.of, sides)
  }

  const branch = (id: string): Branch => {
    const size = sizes.get(id)!
    const own: Rect = { x0: -size.width / 2, y0: -size.height / 2, x1: size.width / 2, y1: size.height / 2 }
    const centres = new Map([[id, { x: 0, y: 0 }]])
    const boxes = [own]
    for (const side of SIDES) {
      const kids = (children.get(id)?.[side] ?? []).map(branch)
      if (kids.length === 0) continue
      const across = side === 'below' || side === 'above' // the kids line up across the stage
      // Along the line: side by side, each branch clear of the one before, and the kids' own
      // shapes centred on this shape (not their whole branches, which may hang off to one side).
      const spacing = across ? gap.x : gap.y
      const lo = (box: Rect) => (across ? box.x0 : box.y0)
      const hi = (box: Rect) => (across ? box.x1 : box.y1)
      const along = [0]
      for (let i = 1; i < kids.length; i++) along.push(along[i - 1] + hi(kids[i - 1].box) + spacing - lo(kids[i].box))
      const middle = (along[0] + along[along.length - 1]) / 2
      // Away from this shape: every kid's own shape on one line, clear of this shape.
      const away = across ? gap.y : gap.x
      const line =
        side === 'below' ? own.y1 + away + Math.max(...kids.map((kid) => -kid.box.y0))
        : side === 'above' ? own.y0 - away - Math.max(...kids.map((kid) => kid.box.y1))
        : side === 'right' ? own.x1 + away + Math.max(...kids.map((kid) => -kid.box.x0))
        : own.x0 - away - Math.max(...kids.map((kid) => kid.box.x1))
      let offsets = kids.map((_, i) => (across ? { x: along[i] - middle, y: line } : { x: line, y: along[i] - middle }))
      // Move the whole line outwards until it is clear of the branches already placed.
      const step = OUTWARD[side]
      for (let tries = 0; tries < 400; tries++) {
        const clash = kids.some((kid, i) => kid.boxes.some((box) => boxes.some((other) => near(shift(box, offsets[i].x, offsets[i].y), other, BRANCH_MARGIN))))
        if (!clash) break
        offsets = offsets.map((offset) => ({ x: offset.x + step.x * 8, y: offset.y + step.y * 8 }))
      }
      kids.forEach((kid, i) => {
        for (const [kidId, centre] of kid.centres) centres.set(kidId, { x: centre.x + offsets[i].x, y: centre.y + offsets[i].y })
        boxes.push(...kid.boxes.map((box) => shift(box, offsets[i].x, offsets[i].y)))
      })
    }
    return { centres, boxes, box: union(boxes) }
  }

  // Everything not placed against anything starts a branch; branches stand side by side.
  const branches = ids.filter((id) => !placed.has(id)).map(branch)
  const centres = new Map<string, { x: number; y: number }>()
  const boxes: Rect[] = []
  let cursor = 0
  for (const b of branches) {
    const offset = roots === 'row' ? { x: cursor - b.box.x0, y: 0 } : { x: 0, y: cursor - b.box.y0 }
    cursor += roots === 'row' ? b.box.x1 - b.box.x0 + gap.x : b.box.y1 - b.box.y0 + gap.y
    for (const [id, centre] of b.centres) centres.set(id, { x: centre.x + offset.x, y: centre.y + offset.y })
    boxes.push(...b.boxes.map((box) => shift(box, offset.x, offset.y)))
  }
  const whole = union(boxes)
  const mid = { x: (whole.x0 + whole.x1) / 2, y: (whole.y0 + whole.y1) / 2 }
  for (const [id, centre] of centres) centres.set(id, { x: centre.x - mid.x, y: centre.y - mid.y })
  return { centres, box: shift(whole, -mid.x, -mid.y) }
}

/** Relative placement on the board: arranged at full size, then scaled to fit the area. */
function placeRelative(
  shapes: Element[],
  placed: Map<string, Place>,
  links: ElementOf<'link'>[],
  layout: Layout,
  area: Rect,
  placements: Map<string, Placement>,
  blocks: Map<string, Block>,
): void {
  const labelRoom = Math.max(0, ...links.map((link) => (link.label ? textWidth(link.label, LINK_LABEL_SIZE) + 40 : 0)))
  const gap = links.length > 0 ? { x: Math.max(LINKED_GAP.x, labelRoom), y: LINKED_GAP.y } : GAP
  const sizes = new Map(shapes.map((shape) => [shape.id, blocks.get(shape.id)?.size ?? measure(shape)]))
  const tall = area.y1 - area.y0 > area.x1 - area.x0
  const roots = layout === 'column' || (tall && layout !== 'row') ? 'column' : 'row'
  const width = area.x1 - area.x0
  const height = area.y1 - area.y0
  // Arranged at full size and then shrunk to fit, arrows shrink too. Where they would become too
  // short to read, open the gaps up and arrange again (shapes get smaller, arrows longer).
  let spacing = gap
  let arranged = arrangeRelative(shapes.map((shape) => shape.id), sizes, placed, spacing, roots)
  let scale = 1
  for (let tries = 0; ; tries++) {
    const { box } = arranged
    scale = Math.min(MAX_SCALE, width / (box.x1 - box.x0), height / (box.y1 - box.y0))
    const shortest = Math.min(spacing.x, spacing.y) * scale
    if (links.length === 0 || shortest >= READABLE_GAP || tries === 6) break
    const grow = Math.min(2, READABLE_GAP / shortest + 0.05)
    spacing = { x: spacing.x * grow, y: spacing.y * grow }
    arranged = arrangeRelative(shapes.map((shape) => shape.id), sizes, placed, spacing, roots)
  }
  const { centres } = arranged
  const centre = { x: (area.x0 + area.x1) / 2, y: (area.y0 + area.y1) / 2 }
  for (const [id, at] of centres) {
    const size = sizes.get(id)!
    placements.set(id, { x: centre.x + (at.x - size.cx) * scale, y: centre.y + (at.y - size.cy) * scale, scale, curve: 0 })
  }
}

/** Stacks notes at the bottom of the region (or centred when they are all there is); returns what is left. */
function placeNotes(notes: ElementOf<'text'>[], region: Rect, belowDiagram: boolean, placements: Map<string, Placement>): Rect {
  if (notes.length === 0) return region
  const sizes = notes.map(measure)
  const height = sizes.reduce((sum, size) => sum + size.height, 0) + NOTE_GAP * (notes.length - 1)
  let y = belowDiagram ? region.y1 - height : (region.y0 + region.y1 - height) / 2
  notes.forEach((note, i) => {
    const size = sizes[i]
    placements.set(note.id, { x: (region.x0 + region.x1) / 2 - size.cx, y: y + size.height / 2 - size.cy, scale: 1, curve: 0 })
    y += size.height + NOTE_GAP
  })
  return belowDiagram ? { ...region, y1: region.y1 - height - GAP.y } : region
}

function placeShapes(
  shapes: Element[],
  links: ElementOf<'link'>[],
  layout: Layout,
  area: Rect,
  placements: Map<string, Placement>,
  blocks: Map<string, Block>,
): void {
  // Linked shapes need room for an arrow and for the longest link label beside it.
  const labelRoom = Math.max(0, ...links.map((link) => (link.label ? textWidth(link.label, LINK_LABEL_SIZE) + 40 : 0)))
  const gap = links.length > 0 ? { x: Math.max(LINKED_GAP.x, labelRoom), y: LINKED_GAP.y } : GAP
  const sizes = shapes.map((shape) => blocks.get(shape.id)?.size ?? measure(shape))
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
  const span = (of: (cell: Cell) => number) => {
    const values = cells.map(of)
    const [lo, hi] = [Math.min(...values), Math.max(...values)]
    return { count: hi - lo + 1, mid: (hi + lo) / 2 }
  }
  const { count: cols, mid: midCol } = span((cell) => cell.col)
  const { count: rows, mid: midRow } = span((cell) => cell.row)
  const spanW = cols * cellW + (cols - 1) * gap.x
  const spanH = rows * cellH + (rows - 1) * gap.y
  const scale = Math.min(MAX_SCALE, width / spanW, height / spanH)

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
  if (layout === 'flow') {
    const cells = flowCells(shapes, links)
    // On a tall stage a flow runs downwards: its steps become rows, side branches columns.
    return height > width ? cells.map(({ col, row }) => ({ col: row, row: col })) : cells
  }

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
function routeLinks(links: ElementOf<'link'>[], shapes: Element[], groups: ElementOf<'group'>[], placements: Map<string, Placement>): void {
  const byId = new Map<string, Element>([...shapes, ...groups].map((el) => [el.id, el]))
  // A group as an arrow end is its frame, around its members.
  const placed = (el: Element): Placed =>
    el.kind === 'group'
      ? (placedGroup(el, el.contains.filter((id) => placements.has(id) && byId.has(id)).map((id) => placed(byId.get(id)!))) ?? { el, ...placements.get(el.id)! })
      : { el, ...placements.get(el.id)! }

  for (const link of links) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (!from || !to || !placements.has(from.id) || !placements.has(to.id)) continue
    // Shapes inside a group the arrow starts or ends at are behind its frame, not in its way.
    const inside = new Set([from, to].flatMap((end) => (end.kind === 'group' ? end.contains : [])))
    const obstacles = shapes
      .filter((shape) => shape !== from && shape !== to && !inside.has(shape.id) && placements.has(shape.id))
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
