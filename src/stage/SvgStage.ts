// Renders a compiled scene as SVG. Theatre.js calls `update()` every frame; it only sets
// attributes on existing nodes, so playback never goes through React.
// Each element's colour is set once on its group (`color`), and its parts use currentColor.
// How each kind looks is in elements.ts; this file keeps the DOM in step with the scene and draws
// what depends on other elements: links between shapes, and group frames around them.

import type { Resolved } from '../scene/compile'
import { bounds, LINK_LABEL_SIZE, linkGeometry, type Placed, type Point, type Rect } from '../scene/geometry'
import { THEME } from '../scene/palette'
import { ANIMATED_PROPS, STAGE, type ElementOf, type SceneElement, type Visual } from '../scene/schema'
import { GROUP } from '../scene/widgets'
import { buildShape, labelText, type Ink } from './elements'
import { pathLength, reveal, roundedRect, seedOf, sketchLine } from './sketch'
import { create, setAttributes, SVG_NS, tree, type Tree } from './svg'

/** Vignette and dot grid: the board the lesson is drawn on. */
const DEFS: Tree = [
  'defs',
  {},
  [
    ['radialGradient', { id: 'vignette', cx: '50%', cy: '45%', r: '70%' }, [
      ['stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.07 }],
      ['stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 }],
    ]],
    ['pattern', { id: 'grid', width: 32, height: 32, patternUnits: 'userSpaceOnUse' }, [
      ['circle', { cx: 16, cy: 16, r: 1.2, fill: '#fff', 'fill-opacity': 0.06 }],
    ]],
  ],
]

const DEFAULT_INK: Ink = { text: THEME.text, label: THEME.label }

interface StageNode {
  el: SceneElement
  /** Changes when anything other than an animated value changes, forcing a rebuild. */
  signature: string
  root: SVGGElement
  draw?: (progress: number) => void
  /** A link's line or a group's frame, redrawn when the shapes it depends on move. */
  stroke?: SVGPathElement
  /** Arrowhead, drawn as its own shape so it takes the element's colour in every browser. */
  head?: SVGPathElement
  label?: SVGTextElement
  visual?: Visual
  /** The geometry last drawn, so unchanged frames skip the sketching, and the sketched line's length. */
  drawn?: string
  length?: number
  /** Where a link or group frame is, for the editor's selection outline. */
  box?: Rect
  /** A wide invisible line over a link, so it is easy to click in the editor. */
  hit?: SVGPathElement
}

export class SvgStage {
  readonly svg: SVGSVGElement
  private readonly backdrop: SVGRectElement
  private readonly groupLayer: SVGGElement
  private readonly linkLayer: SVGGElement
  private readonly layer: SVGGElement
  private readonly nodes = new Map<string, StageNode>()
  private readonly placements = new Map<string, Placed>()
  /** Links and groups to redraw when a shape moves. */
  private readonly dependants = new Map<string, StageNode[]>()
  private readonly logo: SVGImageElement
  /** The chapter editor's outline around the selected element; never shown in playback or exports. */
  private readonly selection: SVGRectElement
  private selected: string | null = null

  constructor(container: HTMLElement) {
    this.svg = create('svg', {
      // Explicit, so the serialised SVG (frame export, video) is a valid standalone file.
      xmlns: SVG_NS,
      viewBox: `0 0 ${STAGE.width} ${STAGE.height}`,
      preserveAspectRatio: 'xMidYMid meet',
      'font-family': 'Inter, ui-sans-serif, system-ui, sans-serif',
    })
    this.svg.append(tree(DEFS))
    this.backdrop = create('rect', { width: STAGE.width, height: STAGE.height, fill: THEME.background })
    const vignette = create('rect', { width: STAGE.width, height: STAGE.height, fill: 'url(#vignette)' })
    const grid = create('rect', { width: STAGE.width, height: STAGE.height, fill: 'url(#grid)' })
    this.groupLayer = create('g')
    this.linkLayer = create('g')
    this.layer = create('g')
    // A brand logo, top right, above the drawing (src/scene/brand.ts).
    this.logo = create('image', { x: STAGE.width - 236, y: 24, width: 200, height: 48, preserveAspectRatio: 'xMaxYMin meet', visibility: 'hidden' })
    this.selection = create('rect', { fill: 'none', rx: 10, 'stroke-width': 2.5, 'stroke-dasharray': '7 6', visibility: 'hidden', 'pointer-events': 'none', style: 'stroke: var(--color-accent, #c8402a)' })
    this.svg.append(this.backdrop, vignette, grid, this.groupLayer, this.linkLayer, this.layer, this.logo, this.selection)
    container.append(this.svg)
  }

  /** Makes the DOM match the scene, reusing nodes whose structure is unchanged. */
  render(scene: Resolved): void {
    this.backdrop.setAttribute('fill', scene.background)
    this.svg.style.setProperty('--stage-bg', scene.background)
    const ink = scene.ink ?? DEFAULT_INK
    if (scene.logo) this.logo.setAttribute('href', scene.logo)
    this.logo.setAttribute('visibility', scene.logo ? 'visible' : 'hidden')

    const ids = new Set(scene.elements.map((el) => el.id))
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) this.remove(id, node)
    }

    this.dependants.clear()
    for (const el of scene.elements) {
      const signature = structure(el, ink)
      let node = this.nodes.get(el.id)
      if (node?.signature !== signature) {
        node?.root.remove()
        node = build(el, signature, ink)
        node.root.setAttribute('data-id', el.id)
        this.nodes.set(el.id, node)
      }
      const dependsOn = el.kind === 'link' ? [el.from, el.to] : el.kind === 'group' ? el.contains : []
      for (const id of dependsOn) this.dependants.set(id, [...(this.dependants.get(id) ?? []), node])
      const layer = el.kind === 'link' ? this.linkLayer : el.kind === 'group' ? this.groupLayer : this.layer
      layer.append(node.root) // paint order follows the scene
    }
    // Shapes first, so links and frames find their ends and members in place.
    for (const el of scene.elements) if (el.kind !== 'link' && el.kind !== 'group') this.update(el.id, el)
    for (const el of scene.elements) if (el.kind === 'link' || el.kind === 'group') this.update(el.id, el)
  }

  update(id: string, visual: Visual): void {
    const node = this.nodes.get(id)
    if (!node) return
    node.visual = visual
    node.root.setAttribute('opacity', String(visual.opacity))
    node.root.setAttribute('color', visual.color)
    // Only what can be seen can be clicked in the editor.
    node.root.setAttribute('pointer-events', visual.opacity < 0.05 ? 'none' : 'auto')

    if (node.el.kind === 'link') return this.drawLink(node)
    if (node.el.kind === 'group') return this.drawGroup(node)
    node.root.setAttribute('transform', `translate(${visual.x} ${visual.y}) rotate(${visual.rotation}) scale(${visual.scale})`)
    node.draw?.(visual.draw)
    this.placements.set(id, { el: node.el, x: visual.x, y: visual.y, scale: visual.scale })
    this.dependants.get(id)?.forEach((dependant) => (dependant.el.kind === 'link' ? this.drawLink(dependant) : this.drawGroup(dependant)))
    if (id === this.selected) this.drawSelection()
  }

  /** Outlines one element for the chapter editor, or none. */
  select(id: string | null): void {
    this.selected = id
    this.drawSelection()
  }

  private drawSelection(): void {
    const node = this.selected ? this.nodes.get(this.selected) : undefined
    const placed = this.selected ? this.placements.get(this.selected) : undefined
    const rect = node?.box ?? (placed ? bounds(placed) : null)
    if (!rect) {
      this.selection.setAttribute('visibility', 'hidden')
      return
    }
    const pad = 10
    setAttributes(this.selection, { x: rect.x0 - pad, y: rect.y0 - pad, width: rect.x1 - rect.x0 + pad * 2, height: rect.y1 - rect.y0 + pad * 2, visibility: 'visible' })
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
    if (node.drawn !== geometry.d) {
      node.drawn = geometry.d
      const d = sketchLine(geometry.d, seedOf(el.id))
      node.stroke.setAttribute('d', d)
      node.hit?.setAttribute('d', geometry.d)
      node.length = pathLength(d)
      const points = [0, 0.25, 0.5, 0.75, 1].map((u) => geometry.at(u))
      node.box = { x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)), x1: Math.max(...points.map((p) => p.x)), y1: Math.max(...points.map((p) => p.y)) }
      if (el.id === this.selected) this.drawSelection()
      if (node.head) placeHead(node.head, geometry.at(0.97), geometry.at(1))
      if (node.label) {
        const mid = geometry.at(0.5)
        setAttributes(node.label, { x: mid.x, y: mid.y - LINK_LABEL_SIZE })
      }
    }
    const draw = node.visual.draw
    if (!el.dashed) reveal(node.stroke, node.length!, draw)
    node.head?.setAttribute('visibility', draw > 0.98 ? 'visible' : 'hidden')
  }

  /** A frame around the group's members, wherever they are, with the label in a band at the top. */
  private drawGroup(node: StageNode): void {
    const el = node.el as ElementOf<'group'>
    const members = el.contains.map((id) => this.placements.get(id)).filter((placed): placed is Placed => Boolean(placed))
    const rects = members.map((placed) => bounds(placed)).filter((rect): rect is Rect => Boolean(rect))
    if (rects.length === 0 || !node.stroke) return
    const scale = members[0].scale
    const pad = GROUP.pad * scale
    const frame = {
      x0: Math.min(...rects.map((r) => r.x0)) - pad,
      y0: Math.min(...rects.map((r) => r.y0)) - pad - GROUP.label * scale,
      x1: Math.max(...rects.map((r) => r.x1)) + pad,
      y1: Math.max(...rects.map((r) => r.y1)) + pad,
    }
    const outline = roundedRect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0, 22 * scale)
    if (node.drawn === outline) return
    node.drawn = outline
    node.box = frame
    if (el.id === this.selected) this.drawSelection()
    node.stroke.setAttribute('d', sketchLine(outline, seedOf(el.id)))
    ;(node.root.firstChild as SVGPathElement).setAttribute('d', outline)
    if (node.label) setAttributes(node.label, { x: frame.x0 + 22 * scale, y: frame.y0 + (GROUP.label * scale) / 2 + 8 * scale, 'font-size': GROUP.text * scale })
  }

  private remove(id: string, node: StageNode): void {
    node.root.remove()
    this.nodes.delete(id)
    this.placements.delete(id)
  }
}

function build(el: SceneElement, signature: string, ink: Ink): StageNode {
  if (el.kind === 'link') {
    const root = create('g')
    const node: StageNode = { el, signature, root }
    node.stroke = create('path', {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      ...(el.dashed && { 'stroke-dasharray': '10 9' }),
    })
    node.hit = create('path', { fill: 'none', stroke: 'transparent', 'stroke-width': 18 })
    root.append(node.stroke, node.hit)
    if (el.arrow) {
      node.head = create('path', { d: 'M -13 -7.5 L 1 0 L -13 7.5 Z', fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' })
      root.append(node.head)
    }
    if (el.label) {
      node.label = labelText(el.label, 0, false, ink, LINK_LABEL_SIZE)
      root.append(node.label)
    }
    return node
  }

  if (el.kind === 'group') {
    const root = create('g')
    const node: StageNode = { el, signature, root }
    root.append(create('path', { fill: 'currentColor', 'fill-opacity': 0.06 }))
    node.stroke = create('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-dasharray': '12 8', 'stroke-linecap': 'round' })
    root.append(node.stroke)
    if (el.label) {
      node.label = create('text', { 'font-weight': 700, 'dominant-baseline': 'central', fill: 'currentColor' })
      node.label.textContent = el.label
      root.append(node.label)
    }
    return node
  }

  const part = buildShape(el, ink)
  return { el, signature, root: part.root, draw: part.draw, label: part.label }
}

function placeHead(head: SVGPathElement, before: Point, tip: Point): void {
  const angle = (Math.atan2(tip.y - before.y, tip.x - before.x) * 180) / Math.PI
  head.setAttribute('transform', `translate(${tip.x} ${tip.y}) rotate(${angle})`)
}

/** Everything about an element except its animated values (and the stage's ink, which labels use). */
function structure(el: SceneElement, ink: Ink): string {
  const fixed: Record<string, unknown> = { ...el, ink }
  for (const prop of ANIMATED_PROPS) delete fixed[prop]
  return JSON.stringify(fixed)
}
