// The value of every element at a moment, read straight from a Theatre project state: the same
// keyframes and easing Theatre plays, without Theatre. Video export draws frames with it.

import { rgbaToCss, type Rgba } from './color'
import type { Resolved } from './compile'
import type { Visual } from './schema'
import { SHEET, type TheatreState } from './theatre'

interface Keyframe {
  position: number
  connectedRight: boolean
  handles: [number, number, number, number]
  value: number | Rgba
}

/** A cubic Bézier from (0,0) to (1,1); finds y for a given x (Theatre's keyframe easing). */
function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (at(x1, x2, mid) < x) lo = mid
    else hi = mid
  }
  return at(y1, y2, (lo + hi) / 2)
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u

function valueAt(keyframes: Keyframe[], t: number): number | Rgba {
  if (t <= keyframes[0].position) return keyframes[0].value
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (t >= b.position) continue
    if (!a.connectedRight) return a.value
    const u = bezier(a.handles[2], a.handles[3], b.handles[0], b.handles[1], (t - a.position) / (b.position - a.position))
    if (typeof a.value === 'number') return lerp(a.value, b.value as number, u)
    const to = b.value as Rgba
    return { r: lerp(a.value.r, to.r, u), g: lerp(a.value.g, to.g, u), b: lerp(a.value.b, to.b, u), a: lerp(a.value.a, to.a, u) }
  }
  return keyframes[keyframes.length - 1].value
}

/** Every element's visual values at `t` seconds. */
export function sampleAt(resolved: Resolved, state: TheatreState, t: number): Map<string, Visual> {
  const sheet = state.sheetsById[SHEET]
  const visuals = new Map<string, Visual>()
  for (const el of resolved.elements) {
    const visual: Visual = { x: el.x, y: el.y, rotation: el.rotation, scale: el.scale, opacity: el.opacity, draw: el.draw, color: el.color }
    const overrides = sheet?.staticOverrides.byObject[el.id] ?? {}
    const tracks = sheet?.sequence.tracksByObject[el.id]
    for (const prop of Object.keys(visual) as (keyof Visual)[]) {
      let value: number | Rgba | undefined = overrides[prop] as number | Rgba | undefined
      const trackId = tracks?.trackIdByPropPath[JSON.stringify([prop])]
      const keyframes = trackId ? (tracks!.trackData[trackId].keyframes as Keyframe[]) : []
      if (keyframes.length > 0) value = valueAt(keyframes, t)
      if (value === undefined) continue
      ;(visual as unknown as Record<string, unknown>)[prop] = typeof value === 'number' ? value : rgbaToCss(value)
    }
    visuals.set(el.id, visual)
  }
  return visuals
}
