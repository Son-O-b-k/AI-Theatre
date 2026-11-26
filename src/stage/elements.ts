// How each kind of element is drawn. Every part is in the element's own coordinates (centred on
// 0,0) and painted with currentColor, so moving, scaling and recolouring the element's group
// animates it. Elements that draw themselves in return a `draw` function taking progress 0..1.

import { hexToRgba } from '../scene/color'
import { hasShapeLabel, innerIcon, LABEL_SIZE, labelOffset, labelPosition, PIN_RADIUS, shapeExtent } from '../scene/geometry'
import { photoSize } from '../scene/images'
import { ICON_GRID, ICONS, ILLUSTRATIONS, type ArtNode } from '../scene/library'
import { accentFor, PALETTE } from '../scene/palette'
import type { ElementOf, MARKS, SceneElement } from '../scene/schema'
import { lineHeight, textWidth, wrapText } from '../scene/text'
import { artSize, chartLayout, CHART, counterText, TABLE, tableLayout, TIMELINE, timelineLayout } from '../scene/widgets'
import { pathLength, reveal, roundedRect, seedOf, sketchCircle, sketchLine, sketchOutline } from './sketch'
import { clamp01, create, lines, type Attributes } from './svg'

export type Ink = { text: string; label: string }

export interface Part {
  root: SVGGElement
  /** Shows the element drawing itself in, from 0 (nothing) to 1 (complete). */
  draw?: (progress: number) => void
  label?: SVGTextElement
}

/** Handwriting for notes, like chalk on a board. Caveat is shipped with the app and the exports. */
export const HAND_FONT = "Caveat, 'Segoe Print', cursive"
const HAND_SCALE = 1.15

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
const easeOut = (u: number) => 1 - (1 - u) ** 3

/** Builds any element except links and groups, which the stage draws around other elements. */
export function buildShape(el: SceneElement, ink: Ink): Part {
  const root = create('g')
  const part: Part = { root }
  const seed = seedOf(el.id)

  switch (el.kind) {
    case 'box': {
      const outline = roundedRect(-el.w / 2, -el.h / 2, el.w, el.h, 18)
      root.append(create('path', { d: outline, fill: 'currentColor', 'fill-opacity': 0.14 }), create('path', { d: sketchOutline(outline, seed), ...STROKE }))
      if (el.icon) root.append(icon(el.icon, innerIcon(el)))
      break
    }
    case 'circle':
      root.append(create('circle', { r: el.r, fill: 'currentColor', 'fill-opacity': 0.14 }), create('path', { d: sketchCircle(el.r, seed), ...STROKE }))
      if (el.icon) root.append(icon(el.icon, innerIcon(el)))
      break

    case 'icon':
      root.append(icon(el.icon, { size: el.size, y: 0 }))
      break

    case 'dot':
      root.append(create('circle', { r: el.r * 2.2, fill: 'currentColor', 'fill-opacity': 0.22 }), create('circle', { r: el.r, fill: 'currentColor' }))
      break

    case 'text': {
      const text = wrapText(el.text, el.size, el.width)
      const hand = el.font !== 'sans'
      const attributes: Attributes = hand
        ? { 'font-family': HAND_FONT, 'font-size': el.size * HAND_SCALE, 'font-weight': Math.max(500, el.weight), fill: 'currentColor' }
        : { 'font-size': el.size, 'font-weight': el.weight, fill: 'currentColor' }
      root.append(lines(text, attributes, (-(text.length - 1) / 2) * lineHeight(el.size), lineHeight(el.size)))
      break
    }
    case 'illustration':
      part.draw = illustration(root, el)
      break
    case 'chart':
      part.draw = chart(root, el, ink)
      break
    case 'counter':
      part.draw = counter(root, el)
      break
    case 'timeline':
      part.draw = timeline(root, el, ink)
      break
    case 'table':
      part.draw = table(root, el, ink)
      break
    case 'photo':
      part.draw = photo(root, el, ink)
      break
    case 'pin':
      root.append(
        create('circle', { r: PIN_RADIUS, fill: 'currentColor', 'fill-opacity': 0.25, stroke: 'currentColor', 'stroke-width': 3.5 }),
        create('circle', { r: 4, fill: 'currentColor' }),
      )
      break
  }

  if ('mark' in el && el.mark) {
    // On the corner of a card; for round and free-standing shapes, nearer their middle.
    const extent = shapeExtent(el)!
    const inset = el.kind === 'box' ? 6 : el.kind === 'circle' ? el.r * 0.3 : extent.hw * 0.15
    root.append(markBadge(el.mark, extent.hw - inset, -extent.hh + inset))
  }

  if (hasShapeLabel(el)) {
    part.label = labelText(el.label!, labelOffset(el), labelPosition(el) === 'inside', ink)
    root.append(part.label)
  }
  return part
}

export type Mark = (typeof MARKS)[number]

export const MARK_RADIUS = 15
const MARK_LOOK: Record<Mark, { color: string; d: string }> = {
  ok: { color: PALETTE.green, d: 'M -6 0.5 L -2 4.5 L 6 -4.5' },
  no: { color: PALETTE.red, d: 'M -4.5 -4.5 L 4.5 4.5 M 4.5 -4.5 L -4.5 4.5' },
  ask: { color: PALETTE.amber, d: 'M -4 -3.5 C -4 -8 4 -8 4 -3.5 C 4 -0.5 0 -0.5 0 2.5 M 0 7 L 0 7.2' },
  warn: { color: PALETTE.orange, d: 'M 0 -6 L 0 2 M 0 6.5 L 0 6.7' },
}

/** A round status badge (✓ ✗ ? !) in its own fixed colour, ringed in the board colour to stand clear. */
export function markBadge(mark: Mark, x: number, y: number): SVGGElement {
  const look = MARK_LOOK[mark]
  const badge = create('g', { transform: `translate(${x} ${y})`, 'data-mark': mark })
  badge.append(
    create('circle', { r: MARK_RADIUS, fill: look.color, style: 'stroke: var(--stage-bg)', 'stroke-width': 3.5 }),
    create('path', { d: look.d, fill: 'none', style: 'stroke: var(--stage-bg)', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  )
  return badge
}

export function labelText(text: string, y: number, inside: boolean, ink: Ink, size = LABEL_SIZE): SVGTextElement {
  const label = create('text', {
    y,
    'font-size': size,
    'font-weight': 600,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill: inside ? ink.text : ink.label,
  })
  // A halo in the background colour keeps outside labels readable over lines.
  if (!inside) label.setAttribute('style', 'paint-order: stroke; stroke: var(--stage-bg); stroke-width: 6px; stroke-linejoin: round')
  label.textContent = text
  return label
}

function icon(name: string, { size, y }: { size: number; y: number }): SVGGElement {
  const group = create('g', {
    transform: `translate(${-size / 2} ${y - size / 2}) scale(${size / ICON_GRID})`,
    ...STROKE,
    'stroke-width': 1.6,
  })
  for (const [tag, attributes] of ICONS[name] ?? []) group.append(create(tag as keyof SVGElementTagNameMap, attributes))
  return group
}

/**
 * A drawing from the content library, sketched in line by line in the order it was drawn; then its
 * fills wash in. Each filled shape sits on the stage colour, so it covers what is drawn behind it.
 */
function illustration(root: SVGGElement, el: ElementOf<'illustration'>): Part['draw'] {
  const art = ILLUSTRATIONS[el.art]
  const { w, h } = artSize(el)
  if (!art) {
    // Removed from the library since the lesson was made: a card keeps its place and label.
    const outline = roundedRect(-w / 2, -h / 2, w, h, 18)
    root.append(create('path', { d: outline, fill: 'currentColor', 'fill-opacity': 0.14 }), create('path', { d: sketchOutline(outline, seedOf(el.id)), ...STROKE }))
    return undefined
  }
  const frame = create('g', { transform: `translate(${-w / 2} ${-h / 2}) scale(${w / art.width})`, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })
  // Details drawn in a clear colour in the file take the second colour; the rest takes the element's.
  const accent = el.accent ?? accentFor(el.color)
  const washes: SVGElement[] = []
  const strokes: { node: SVGElement; length: number; start: number }[] = []
  let total = 0

  const add = (nodes: ArtNode[], parent: SVGElement) => {
    for (const node of nodes) {
      const tag = node.tag as keyof SVGElementTagNameMap
      if (node.children) {
        const group = create('g', node.attrs)
        add(node.children, group)
        parent.append(group)
        continue
      }
      if (node.fill !== undefined) {
        const base = create(tag, { ...node.attrs, style: 'fill: var(--stage-bg)', stroke: 'none' })
        const tint = create(tag, { ...node.attrs, fill: node.accentFill ? accent : 'currentColor', 'fill-opacity': node.fill, stroke: 'none' })
        parent.append(base, tint)
        washes.push(base, tint)
      }
      if (node.stroke !== undefined) {
        const line = create(tag, { ...node.attrs, fill: 'none', stroke: node.accentStroke ? accent : 'currentColor', 'stroke-opacity': node.stroke })
        parent.append(line)
        // Lines that are dashed in the drawing keep their dashes and wash in with the fills.
        if (node.attrs['stroke-dasharray'] !== undefined || !node.length) washes.push(line)
        else {
          strokes.push({ node: line, length: node.length, start: total })
          total += node.length
        }
      }
    }
  }
  add(art.nodes, frame)
  root.append(frame)

  return (progress) => {
    const drawn = clamp01(progress / 0.8) * total
    for (const stroke of strokes) reveal(stroke.node, stroke.length, clamp01((drawn - stroke.start) / stroke.length))
    const wash = String(clamp01((progress - 0.55) / 0.45))
    for (const node of washes) node.setAttribute('opacity', wash)
  }
}

/**
 * One of the creator's pictures in a hand-drawn frame. As a sketch, its edges are traced in the
 * stage's ink and drawn in left to right, then the picture washes in faintly underneath, like the
 * library's drawings. Ids of the clip and filter come from what they depend on, so two stages on
 * one page share them harmlessly.
 */
function photo(root: SVGGElement, el: ElementOf<'photo'>, ink: Ink): Part['draw'] {
  const { w, h } = photoSize(el)
  const key = seedOf(`${el.src}|${w}|${h}|${ink.text}`)
  const frame = roundedRect(-w / 2, -h / 2, w, h, 14)
  const defs = create('defs')
  const clip = create('clipPath', { id: `photo-clip-${key}` })
  clip.append(create('path', { d: frame }))
  defs.append(clip)
  root.append(defs)
  const picture = (attributes: Attributes = {}) =>
    create('image', { href: el.src ?? '', x: -w / 2, y: -h / 2, width: w, height: h, preserveAspectRatio: 'xMidYMid slice', ...attributes })
  const outline = sketchOutline(frame, seedOf(el.id))
  const credit = el.credit ? creditText(el.credit, w, h) : null

  if (el.look !== 'sketch') {
    const shown = create('g', { 'clip-path': `url(#photo-clip-${key})` })
    shown.append(picture())
    root.append(shown, create('path', { d: outline, ...STROKE, 'stroke-opacity': 0.8 }))
    if (credit) root.append(credit)
    return undefined
  }

  // Edges: grey, a little softened, then a Laplacian kernel; their strength becomes the ink's opacity.
  const { r, g, b } = hexToRgba(ink.text)
  const filter = create('filter', { id: `photo-sketch-${key}`, x: 0, y: 0, width: 1, height: 1, 'color-interpolation-filters': 'sRGB' })
  filter.append(
    create('feColorMatrix', { type: 'saturate', values: 0 }),
    create('feGaussianBlur', { stdDeviation: 1.3 }),
    create('feConvolveMatrix', { order: 3, kernelMatrix: '-1 -1 -1 -1 8 -1 -1 -1 -1', preserveAlpha: 'true' }),
    create('feColorMatrix', { type: 'matrix', values: `0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 5 5 5 0 -0.2` }),
  )
  const sweep = create('rect', { x: -w / 2, y: -h / 2, width: 0, height: h })
  const wipe = create('clipPath', { id: `photo-wipe-${el.id}-${key}` })
  wipe.append(sweep)
  defs.append(filter, wipe)

  const wash = create('g', { 'clip-path': `url(#photo-clip-${key})`, opacity: 0 })
  wash.append(picture())
  const traced = create('g', { 'clip-path': `url(#photo-wipe-${el.id}-${key})` })
  const lines = create('g', { 'clip-path': `url(#photo-clip-${key})` })
  lines.append(picture({ filter: `url(#photo-sketch-${key})` }))
  traced.append(lines)
  const border = create('path', { d: outline, ...STROKE })
  const length = pathLength(outline)
  root.append(wash, traced, border)
  if (credit) root.append(credit)

  return (progress) => {
    sweep.setAttribute('width', String(w * clamp01(progress / 0.75)))
    reveal(border, length, clamp01(progress / 0.75))
    wash.setAttribute('opacity', String(0.35 * clamp01((progress - 0.6) / 0.4)))
    credit?.setAttribute('opacity', String(clamp01((progress - 0.6) / 0.4)))
  }
}

/** The picture's author and licence, small on a dark band in its bottom right corner (open licences ask for it). */
function creditText(text: string, w: number, h: number): SVGGElement {
  const size = 11
  const fits = Math.floor((w - 24) / (size * 0.55))
  const shown = text.length > fits ? `${text.slice(0, fits - 1)}…` : text
  const width = Math.min(w - 8, textWidth(shown, size) + 12)
  const group = create('g')
  const credit = create('text', { x: w / 2 - 10, y: h / 2 - 10, 'text-anchor': 'end', 'font-size': size, 'font-weight': 500, fill: '#fff', 'fill-opacity': 0.9 })
  credit.textContent = shown
  group.append(create('rect', { x: w / 2 - 4 - width, y: h / 2 - 24, width, height: 18, rx: 5, fill: '#000', 'fill-opacity': 0.55 }), credit)
  return group
}

/** Bars grow one after another; each value appears as its bar arrives. */
function chart(root: SVGGElement, el: ElementOf<'chart'>, ink: Ink): Part['draw'] {
  const { baseline, bars } = chartLayout(el)
  root.append(create('path', { d: sketchLine(`M ${-CHART.width / 2} ${baseline} H ${CHART.width / 2}`, seedOf(el.id)), ...STROKE }))
  const parts = bars.map((bar) => {
    const rect = create('rect', { x: bar.x - bar.width / 2, width: bar.width, rx: 4, fill: 'currentColor', 'fill-opacity': 0.3, stroke: 'currentColor', 'stroke-width': 2.5 })
    const value = create('text', { x: bar.x, 'text-anchor': 'middle', 'font-size': CHART.text, 'font-weight': 700, fill: ink.text })
    value.textContent = bar.value
    root.append(rect, value, lines(bar.label, { x: bar.x, 'font-size': CHART.text, 'font-weight': 500, fill: ink.label }, baseline + 22, lineHeight(CHART.text)))
    return { bar, rect, value }
  })
  return (progress) =>
    parts.forEach(({ bar, rect, value }, i) => {
      const grow = easeOut(clamp01((progress - (i / parts.length) * 0.45) / 0.55))
      const height = bar.height * grow
      rect.setAttribute('y', String(baseline - height))
      rect.setAttribute('height', String(height))
      rect.setAttribute('visibility', height > 0.5 ? 'visible' : 'hidden')
      value.setAttribute('y', String(baseline - height - 12))
      value.setAttribute('opacity', String(clamp01((grow - 0.7) / 0.3)))
    })
}

function counter(root: SVGGElement, el: ElementOf<'counter'>): Part['draw'] {
  const text = create('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': el.size, 'font-weight': 700, fill: 'currentColor' })
  text.textContent = counterText(el, 1)
  root.append(text)
  return (progress) => {
    text.textContent = counterText(el, progress)
  }
}

/** The line is drawn left to right; each moment appears as the line reaches it. */
function timeline(root: SVGGElement, el: ElementOf<'timeline'>, ink: Ink): Part['draw'] {
  const { width, points } = timelineLayout(el)
  const d = sketchLine(`M ${-width / 2} 0 H ${width / 2}`, seedOf(el.id))
  const length = pathLength(d)
  const line = create('path', { d, ...STROKE, 'stroke-width': 3 })
  root.append(line)
  const marks = points.map((point) => {
    const mark = create('g')
    const at = create('text', { x: point.x, y: -TIMELINE.above, 'text-anchor': 'middle', 'font-size': TIMELINE.at, 'font-weight': 700, fill: ink.text })
    at.textContent = point.at
    mark.append(create('circle', { cx: point.x, r: 8, fill: 'currentColor' }), at)
    mark.append(lines(point.label, { x: point.x, 'font-size': TIMELINE.text, 'font-weight': 500, fill: ink.label }, TIMELINE.below, lineHeight(TIMELINE.text)))
    root.append(mark)
    return { mark, at: (point.x + width / 2) / width }
  })
  return (progress) => {
    reveal(line, length, progress)
    for (const { mark, at } of marks) mark.setAttribute('opacity', String(clamp01((progress - at + 0.06) * 8)))
  }
}

/** The frame is drawn first, then the header and each row in turn. */
function table(root: SVGGElement, el: ElementOf<'table'>, ink: Ink): Part['draw'] {
  const { columns, width, height, cells } = tableLayout(el)
  const x0 = -width / 2
  const y0 = -height / 2
  const outline = sketchOutline(roundedRect(x0, y0, width, height, 10), seedOf(el.id))
  root.append(create('path', { d: roundedRect(x0, y0, width, TABLE.row, 10), fill: 'currentColor', 'fill-opacity': 0.2 }), create('path', { d: outline, ...STROKE }))

  const edges = columns.slice(0, -1).reduce<number[]>((xs, w) => [...xs, (xs.at(-1) ?? x0) + w], [])
  const rows = cells.map((row, r) => {
    const group = create('g')
    const top = y0 + r * TABLE.row
    for (const x of edges) group.append(create('path', { d: `M ${x} ${top + 6} V ${top + TABLE.row - 6}`, ...STROKE, 'stroke-width': 1.5, 'stroke-opacity': 0.45 }))
    if (r > 0) group.append(create('path', { d: `M ${x0 + 8} ${top} H ${x0 + width - 8}`, ...STROKE, 'stroke-width': 1.5, 'stroke-opacity': 0.45 }))
    let x = x0
    row.forEach((cell, c) => {
      const text = create('text', { x: x + columns[c] / 2, y: top + TABLE.row / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': TABLE.text, 'font-weight': r === 0 ? 700 : 500, fill: ink.text })
      text.textContent = cell
      group.append(text)
      x += columns[c]
    })
    root.append(group)
    return group
  })
  return (progress) => rows.forEach((row, r) => row.setAttribute('opacity', String(clamp01(progress * rows.length * 1.15 - r))))
}
