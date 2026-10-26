// Renders a compiled scene as SVG. Theatre.js calls `update()` every frame; it only sets
// attributes on existing nodes, so playback never goes through React.
// Each element's colour is set once on its group (`color`), and its parts use currentColor.

import type { Resolved } from '../scene/compile'
import {
  hasShapeLabel,
  innerIcon,
  LABEL_SIZE,
  LINK_LABEL_SIZE,
  labelOffset,
  labelPosition,
  lineHeight,
  linkGeometry,
  wrapText,
  type Placed,
  type Point,
} from '../scene/geometry'
import { ICON_GRID, ICONS } from '../scene/icons'
import { THEME } from '../scene/palette'
import { ANIMATED_PROPS, STAGE, type ElementOf, type SceneElement, type Visual } from '../scene/schema'

const SVG_NS = 'http://www.w3.org/2000/svg'

const DEFS = `
<defs>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
    <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.45"/>
  </filter>
  <radialGradient id="vignette" cx="50%" cy="45%" r="70%">
    <stop offset="0" stop-color="#fff" stop-opacity="0.07"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
    <circle cx="16" cy="16" r="1.2" fill="#fff" fill-opacity="0.06"/>
  </pattern>
</defs>`

interface StageNode {
  el: SceneElement
  /** Changes when anything other than an animated value changes, forcing a rebuild. */
  signature: string
  root: SVGGElement
  stroke?: SVGGeometryElement
  /** Arrowhead, drawn as its own shape so it takes the element's colour in every browser. */
  head?: SVGPathElement
  label?: SVGTextElement
  visual?: Visual
}

export class SvgStage {
  readonly svg: SVGSVGElement
  private readonly backdrop: SVGRectElement
  private readonly linkLayer: SVGGElement
  private readonly layer: SVGGElement
  private readonly nodes = new Map<string, StageNode>()
  private readonly placements = new Map<string, Placed>()
  private readonly linksByEndpoint = new Map<string, StageNode[]>()

  constructor(container: HTMLElement) {
    this.svg = create('svg', {
      viewBox: `0 0 ${STAGE.width} ${STAGE.height}`,
      preserveAspectRatio: 'xMidYMid meet',
      'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
    })
    this.svg.innerHTML = DEFS
    this.backdrop = create('rect', { width: STAGE.width, height: STAGE.height, fill: THEME.background })
    const vignette = create('rect', { width: STAGE.width, height: STAGE.height, fill: 'url(#vignette)' })
    const grid = create('rect', { width: STAGE.width, height: STAGE.height, fill: 'url(#grid)' })
    this.linkLayer = create('g', {})
    this.layer = create('g', {})
    this.svg.append(this.backdrop, vignette, grid, this.linkLayer, this.layer)
    container.append(this.svg)
  }

  /** Makes the DOM match the scene, reusing nodes whose structure is unchanged. */
  render(scene: Resolved): void {
    this.backdrop.setAttribute('fill', scene.background)
    this.svg.style.setProperty('--stage-bg', scene.background)

    const ids = new Set(scene.elements.map((el) => el.id))
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) this.remove(id, node)
    }

    this.linksByEndpoint.clear()
    for (const el of scene.elements) {
      const signature = structure(el)
      let node = this.nodes.get(el.id)
      if (node?.signature !== signature) {
        node?.root.remove()
        node = build(el, signature)
        this.nodes.set(el.id, node)
      }
      if (el.kind === 'link') {
        for (const end of [el.from, el.to]) this.linksByEndpoint.set(end, [...(this.linksByEndpoint.get(end) ?? []), node])
      }
      ;(el.kind === 'link' ? this.linkLayer : this.layer).append(node.root) // paint order follows the scene
      this.update(el.id, el)
    }
  }

  update(id: string, visual: Visual): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.visual = visual
    node.root.setAttribute('opacity', String(visual.opacity))
    node.root.setAttribute('color', visual.color)

    if (node.el.kind === 'link') {
      this.drawLink(node)
      return
    }
    node.root.setAttribute(
      'transform',
      `translate(${visual.x} ${visual.y}) rotate(${visual.rotation}) scale(${visual.scale})`,
    )
    if (node.stroke) setDraw(node, visual.draw)
    this.placements.set(id, { el: node.el, x: visual.x, y: visual.y, scale: visual.scale })
    this.linksByEndpoint.get(id)?.forEach((link) => this.drawLink(link))
  }

  destroy(): void {
    this.svg.remove()
  }

  private drawLink(node: StageNode): void {
    const el = node.el as SceneElement & ElementOf<'link'>
    const from = this.placements.get(el.from)
    const to = this.placements.get(el.to)
    if (!from || !to || !node.visual || !node.stroke) return

    const geometry = linkGeometry(from, to, el.curve)
    node.stroke.setAttribute('d', geometry.d)
    if (node.head) placeHead(node.head, geometry.at(0.97), geometry.at(1))
    setDraw(node, node.visual.draw)
    if (node.label) {
      const mid = geometry.at(0.5)
      setAttributes(node.label, { x: mid.x, y: mid.y - LINK_LABEL_SIZE })
    }
  }

  private remove(id: string, node: StageNode): void {
    node.root.remove()
    this.nodes.delete(id)
    this.placements.delete(id)
  }
}

// ── Building nodes ────────────────────────────────────────────────────────────

function build(el: SceneElement, signature: string): StageNode {
  const root = create('g', {})
  const node: StageNode = { el, signature, root }

  switch (el.kind) {
    case 'box':
      root.append(
        create('rect', {
          x: -el.w / 2,
          y: -el.h / 2,
          width: el.w,
          height: el.h,
          rx: 18,
          fill: 'currentColor',
          'fill-opacity': 0.14,
          stroke: 'currentColor',
          'stroke-width': 2.5,
          filter: 'url(#shadow)',
        }),
      )
      if (el.icon) root.append(icon(el.icon, innerIcon(el)))
      break

    case 'circle':
      root.append(
        create('circle', {
          r: el.r,
          fill: 'currentColor',
          'fill-opacity': 0.14,
          stroke: 'currentColor',
          'stroke-width': 2.5,
          filter: 'url(#shadow)',
        }),
      )
      if (el.icon) root.append(icon(el.icon, innerIcon(el)))
      break

    case 'icon':
      root.append(icon(el.icon, { size: el.size, y: 0 }))
      break

    case 'dot':
      root.append(
        create('circle', { r: el.r * 2.2, fill: 'currentColor', 'fill-opacity': 0.22 }),
        create('circle', { r: el.r, fill: 'currentColor' }),
      )
      break

    case 'text': {
      const lines = wrapText(el.text, el.size, el.width)
      const text = create('text', {
        'font-size': el.size,
        'font-weight': el.weight,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: 'currentColor',
      })
      const first = (-(lines.length - 1) / 2) * lineHeight(el.size)
      lines.forEach((line, i) => {
        const span = create('tspan', { x: 0, y: first + i * lineHeight(el.size) })
        span.textContent = line
        text.append(span)
      })
      root.append(text)
      break
    }

    case 'link':
      node.stroke = strokeShape(create('path', {}), el, 2.5)
      root.append(node.stroke)
      if (el.arrow) node.head = arrowHead(root, { x: 0, y: 0 }, { x: 1, y: 0 })
      if (el.label) {
        node.label = labelText(el.label, 0, false, LINK_LABEL_SIZE)
        root.append(node.label)
      }
      break
  }

  if (hasShapeLabel(el)) {
    node.label = labelText(el.label!, labelOffset(el), labelPosition(el) === 'inside')
    root.append(node.label)
  }
  return node
}

function strokeShape<T extends SVGGeometryElement>(shape: T, el: ElementOf<'link'>, width = 3): T {
  setAttributes(shape, {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    // A normalised length lets `draw` (0..1) reveal the stroke through the dash offset.
    ...(el.dashed ? { 'stroke-dasharray': '10 9' } : { pathLength: 1, 'stroke-dasharray': 1 }),
  })
  return shape
}

/** Reveals a stroke as `draw` goes from 0 to 1; the arrowhead appears once it is fully drawn. */
function setDraw(node: StageNode, draw: number): void {
  const el = node.el as ElementOf<'link'>
  if (!el.dashed) node.stroke!.setAttribute('stroke-dashoffset', String(1 - draw))
  node.head?.setAttribute('visibility', draw > 0.98 ? 'visible' : 'hidden')
}

function arrowHead(root: SVGGElement, before: Point, tip: Point): SVGPathElement {
  const head = create('path', { d: 'M -13 -7.5 L 1 0 L -13 7.5 Z', fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' })
  placeHead(head, before, tip)
  root.append(head)
  return head
}

function placeHead(head: SVGPathElement, before: Point, tip: Point): void {
  const angle = (Math.atan2(tip.y - before.y, tip.x - before.x) * 180) / Math.PI
  head.setAttribute('transform', `translate(${tip.x} ${tip.y}) rotate(${angle})`)
}

function icon(name: string, { size, y }: { size: number; y: number }): SVGGElement {
  const group = create('g', {
    transform: `translate(${-size / 2} ${y - size / 2}) scale(${size / ICON_GRID})`,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
  for (const [tag, attributes] of ICONS[name] ?? []) {
    group.append(create(tag as keyof SVGElementTagNameMap, attributes as Record<string, string | number>))
  }
  return group
}

function labelText(text: string, y: number, inside: boolean, size = LABEL_SIZE): SVGTextElement {
  const label = create('text', {
    y,
    'font-size': size,
    'font-weight': 600,
    'text-anchor': 'middle',
    'dominant-baseline': 'central',
    fill: inside ? THEME.text : THEME.label,
  })
  // A halo in the background colour keeps outside labels readable over lines.
  if (!inside) label.setAttribute('style', 'paint-order: stroke; stroke: var(--stage-bg); stroke-width: 6px; stroke-linejoin: round')
  label.textContent = text
  return label
}

/** Everything about an element except its animated values. */
function structure(el: SceneElement): string {
  const fixed: Record<string, unknown> = { ...el }
  for (const prop of ANIMATED_PROPS) delete fixed[prop]
  return JSON.stringify(fixed)
}

function create<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  setAttributes(node, attributes)
  return node
}

function setAttributes(node: Element, attributes: Record<string, string | number>): void {
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
}
