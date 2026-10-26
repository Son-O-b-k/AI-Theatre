// Shared geometry: the stage draws with it, the compiler moves tokens along links with it,
// and the layout check measures with it, so all three agree on where things are.

import type { Element, ElementOf } from './schema'

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** An element at a specific position and scale (its values at some moment). */
export interface Placed {
  el: Element
  x: number
  y: number
  scale: number
}

export const LABEL_SIZE = 22
export const LINK_LABEL_SIZE = 18
const LABEL_GAP = 12
const CHAR_WIDTH = 0.56 // average glyph width in em, used to estimate text extents

export const textWidth = (text: string, size: number) => text.length * size * CHAR_WIDTH
export const lineHeight = (size: number) => size * 1.25

/** Greedy word wrap using the estimated glyph width. */
export function wrapText(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(8, Math.floor(width / (size * CHAR_WIDTH)))
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    return [...lines, line]
  })
}

/** Half width and height of the shape around its centre, unscaled. Null for open strokes. */
export function shapeExtent(el: Element): { hw: number; hh: number } | null {
  switch (el.kind) {
    case 'box':
      return { hw: el.w / 2, hh: el.h / 2 }
    case 'circle':
    case 'dot':
      return { hw: el.r, hh: el.r }
    case 'icon':
      return { hw: el.size / 2, hh: el.size / 2 }
    case 'text': {
      const lines = wrapText(el.text, el.size, el.width)
      const widest = Math.max(...lines.map((line) => textWidth(line, el.size)))
      return { hw: widest / 2, hh: (lines.length * lineHeight(el.size)) / 2 }
    }
    default:
      return null
  }
}

type Labelled = ElementOf<'box' | 'circle' | 'icon' | 'dot'>

export const hasShapeLabel = (el: Element): el is Labelled =>
  Boolean(el.label) && (el.kind === 'box' || el.kind === 'circle' || el.kind === 'icon' || el.kind === 'dot')

export function labelPosition(el: Labelled): 'below' | 'above' | 'inside' {
  if (el.labelAt) return el.labelAt
  return (el.kind === 'box' || el.kind === 'circle') && !el.icon ? 'inside' : 'below'
}

/** Where a shape's label sits, relative to the element centre. */
export function labelOffset(el: Labelled): number {
  const { hh } = shapeExtent(el)!
  switch (labelPosition(el)) {
    case 'inside':
      return el.kind !== 'icon' && el.kind !== 'dot' && el.icon ? hh * 0.5 : 0
    case 'above':
      return -(hh + LABEL_GAP + LABEL_SIZE / 2)
    case 'below':
      return hh + LABEL_GAP + LABEL_SIZE / 2
  }
}

/** Icon size and vertical offset inside a box or circle. */
export function innerIcon(el: ElementOf<'box' | 'circle'>): { size: number; y: number } {
  const labelInside = hasShapeLabel(el) && labelPosition(el) === 'inside'
  if (el.kind === 'box') {
    const size = Math.min(el.w, el.h) * (labelInside ? 0.36 : 0.46)
    return { size, y: labelInside ? -el.h * 0.12 : 0 }
  }
  const size = el.r * (labelInside ? 0.75 : 0.95)
  return { size, y: labelInside ? -el.r * 0.2 : 0 }
}

/** Bounding box of the shape and its outside label, or null for strokes and links. */
export function bounds({ el, x, y, scale }: Placed): Rect | null {
  const extent = shapeExtent(el)
  if (!extent) return null
  let rect: Rect = { x0: -extent.hw, y0: -extent.hh, x1: extent.hw, y1: extent.hh }

  if (hasShapeLabel(el) && labelPosition(el) !== 'inside') {
    const offset = labelOffset(el)
    const half = textWidth(el.label!, LABEL_SIZE) / 2
    rect = {
      x0: Math.min(rect.x0, -half),
      x1: Math.max(rect.x1, half),
      y0: Math.min(rect.y0, offset - LABEL_SIZE / 2),
      y1: Math.max(rect.y1, offset + LABEL_SIZE / 2),
    }
  }
  return { x0: x + rect.x0 * scale, y0: y + rect.y0 * scale, x1: x + rect.x1 * scale, y1: y + rect.y1 * scale }
}

/**
 * The point where a ray from the element's centre towards `toward` leaves it.
 * Boxes, text and anything with an outside label are treated as their full bounding box,
 * so links never run through a label.
 */
function edgePoint(placed: Placed, toward: Point, gap: number): Point {
  const { el, x, y } = placed
  const dx = toward.x - x
  const dy = toward.y - y
  const length = Math.hypot(dx, dy)
  if (length === 0) return { x, y }
  const ux = dx / length
  const uy = dy / length

  const rect = bounds(placed)
  let distance = 0
  if (rect && (el.kind === 'box' || el.kind === 'text' || (hasShapeLabel(el) && labelPosition(el) !== 'inside'))) {
    const tx = ux > 0 ? (rect.x1 - x) / ux : ux < 0 ? (rect.x0 - x) / ux : Infinity
    const ty = uy > 0 ? (rect.y1 - y) / uy : uy < 0 ? (rect.y0 - y) / uy : Infinity
    distance = Math.min(tx, ty)
  } else if (rect) {
    distance = (rect.x1 - rect.x0) / 2
  }
  return { x: x + ux * (distance + gap), y: y + uy * (distance + gap) }
}

export interface LinkGeometry {
  d: string
  at(u: number): Point
}

/** A quadratic curve between two elements, clipped to their outlines. `curve` bends it sideways (-1..1). */
export function linkGeometry(from: Placed, to: Placed, curve: number): LinkGeometry {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const control = {
    x: (from.x + to.x) / 2 + (-dy / length) * curve * length * 0.5,
    y: (from.y + to.y) / 2 + (dx / length) * curve * length * 0.5,
  }
  const start = edgePoint(from, control, 8)
  const end = edgePoint(to, control, 8)

  const at = (u: number): Point => {
    const v = 1 - u
    return {
      x: v * v * start.x + 2 * v * u * control.x + u * u * end.x,
      y: v * v * start.y + 2 * v * u * control.y + u * u * end.y,
    }
  }
  const r = (n: number) => Math.round(n * 10) / 10
  return { d: `M ${r(start.x)} ${r(start.y)} Q ${r(control.x)} ${r(control.y)} ${r(end.x)} ${r(end.y)}`, at }
}
