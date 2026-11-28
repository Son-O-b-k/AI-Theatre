// Watches a compiled scene play (in quarter-second steps) and reports problems a viewer would
// notice: shapes or labels colliding, things leaving the stage, links crossing shapes or too short
// to read, unlabelled shapes, long stretches where nothing moves. The layout engine is meant to
// make the geometric ones impossible; the tests use this to prove it, and it scores model output.

import type { Resolved } from './compile'
import { bounds, linkGeometry, placedGroup, type Placed, type Rect } from './geometry'
import { crossings, MIN_LINK } from './layout'
import { type AnimatedProp, type Key, type SceneElement } from './schema'

const STEP = 0.25
const VISIBLE = 0.4
const TOLERANCE = 4
const MAX_ISSUES = 10
const MAX_STILL = 8

export function checkScene(scene: Resolved): string[] {
  const value = sampler(scene)
  const issues = new Map<string, string>()
  const report = (id: string, message: string) => issues.has(id) || issues.set(id, message) // keep the first occurrence
  const seen = new Set<string>()
  // Pins sit on their photo by design.
  const solid = scene.elements.filter((el) => el.kind !== 'link' && el.kind !== 'dot' && el.kind !== 'group' && el.kind !== 'pin')
  /** A photo zoomed in fills the stage and may run past its edges; that is the point of it. */
  const zoomed = (el: SceneElement, t: number) => el.kind === 'photo' && value(el, 'scale', t) > el.scale * 1.05

  for (let t = 0; t <= scene.duration; t += STEP) {
    const visible = scene.elements.filter((el) => value(el, 'opacity', t) > VISIBLE)
    visible.forEach((el) => seen.add(el.id))

    const boxes = solid
      .filter((el) => visible.includes(el))
      .map((el) => ({ el, rect: bounds({ el, x: value(el, 'x', t), y: value(el, 'y', t), scale: value(el, 'scale', t) })! }))

    const { width, height } = scene.stage
    for (const { el, rect } of boxes) {
      if (zoomed(el, t)) continue
      if (rect.x0 < -TOLERANCE || rect.y0 < -TOLERANCE || rect.x1 > width + TOLERANCE || rect.y1 > height + TOLERANCE) {
        report(`off:${el.id}`, `"${el.id}" (with its label) goes past the edge of the ${width}x${height} stage at ${t}s`)
      }
    }
    const at = (el: SceneElement): Placed | null =>
      el.kind === 'group'
        ? placedGroup(el, el.contains.map((id) => scene.elements.find((member) => member.id === id)).filter((member) => member !== undefined).map((member) => at(member!)).filter((p): p is Placed => p !== null))
        : { el, x: value(el, 'x', t), y: value(el, 'y', t), scale: value(el, 'scale', t) }
    for (const link of visible) {
      if (link.kind !== 'link') continue
      const ends = [link.from, link.to].map((id) => scene.elements.find((el) => el.id === id))
      if (!ends[0] || !ends[1]) continue
      const from = at(ends[0])
      const to = at(ends[1])
      if (!from || !to) continue
      const path = linkGeometry(from, to, link.curve)
      const start = path.at(0)
      const end = path.at(1)
      if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_LINK) {
        report(`short:${link.id}`, `link "${link.id}" is too short to read at ${t}s`)
      }
      const inside = new Set([ends[0], ends[1]].flatMap((end) => (end!.kind === 'group' ? end!.contains : [])))
      const others = boxes.filter((box) => box.el.id !== link.from && box.el.id !== link.to && !inside.has(box.el.id)).map((box) => box.rect)
      if (crossings(path, others) > 0) report(`cross:${link.id}`, `link "${link.id}" crosses another shape at ${t}s`)
    }

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (overlaps(a.rect, b.rect) && !contains(a.rect, b.rect) && !contains(b.rect, a.rect)) {
          report(`overlap:${a.el.id}:${b.el.id}`, `"${a.el.id}" and "${b.el.id}" overlap at ${t}s (labels count)`)
        }
      }
    }
  }

  for (const el of scene.elements) {
    if (!seen.has(el.id)) report(`hidden:${el.id}`, `"${el.id}" is never visible`)
    if ((el.kind === 'icon' || el.kind === 'box' || el.kind === 'circle') && !el.label) {
      report(`label:${el.id}`, `"${el.id}" has no label, so the viewer cannot tell what it is`)
    }
  }
  for (const [from, to] of stillGaps(scene)) {
    report(`still:${from}`, `nothing changes on stage between ${from}s and ${to}s; add a visual step for the narration there`)
  }
  return [...issues.values()].slice(0, MAX_ISSUES)
}

/** Stretches longer than MAX_STILL seconds where no value is animating. */
function stillGaps(scene: Resolved): [number, number][] {
  const times = [...new Set(scene.keys.map((key) => key.t))].sort((a, b) => a - b)
  const end = scene.duration - 3 // the closing recap may rest
  const gaps: [number, number][] = []
  let last = 0
  for (const t of [...times, end]) {
    if (t - last > MAX_STILL && last < end) gaps.push([round(last), round(Math.min(t, end))])
    last = Math.max(last, t)
  }
  return gaps
}

const round = (n: number) => Math.round(n * 10) / 10

/** Value of a numeric prop at time t, interpolating linearly between keys. */
function sampler(scene: Resolved) {
  const tracks = new Map<string, Key[]>()
  for (const key of scene.keys) {
    const id = `${key.el}.${key.prop}`
    tracks.set(id, [...(tracks.get(id) ?? []), key])
  }
  tracks.forEach((keys) => keys.sort((a, b) => a.t - b.t))

  return (el: SceneElement, prop: Exclude<AnimatedProp, 'color'>, t: number): number => {
    const keys = tracks.get(`${el.id}.${prop}`)
    if (!keys) return el[prop]
    const next = keys.findIndex((key) => key.t >= t)
    if (next === -1) return Number(keys.at(-1)!.v)
    if (next === 0) return Number(keys[0].v)
    const a = keys[next - 1]
    const b = keys[next]
    const u = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t)
    return Number(a.v) + (Number(b.v) - Number(a.v)) * u
  }
}

const overlaps = (a: Rect, b: Rect) =>
  a.x0 < b.x1 - TOLERANCE && b.x0 < a.x1 - TOLERANCE && a.y0 < b.y1 - TOLERANCE && b.y0 < a.y1 - TOLERANCE

const contains = (outer: Rect, inner: Rect) =>
  inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
