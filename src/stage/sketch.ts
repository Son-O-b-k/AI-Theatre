// The hand-drawn look: outlines and lines go through rough.js (MIT), which wobbles them like a pen
// on a board. Each element gets a fixed seed from its id, so it is drawn the same way on every frame,
// in every browser and in exported video.
//
// Strokes are revealed by dashing them with their real length (measured here): resvg, which draws
// exported video, does not support pathLength.

import rough from 'roughjs'
import { svgPathProperties } from 'svg-path-properties'

const generator = rough.generator()

const STYLE = {
  outline: { roughness: 1.1, bowing: 0.9, maxRandomnessOffset: 1.6 },
  line: { roughness: 0.8, bowing: 0.6, disableMultiStroke: true, maxRandomnessOffset: 1.2 },
} as const

/** A stable seed for an element, so its wobble never changes. */
export function seedOf(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return (hash >>> 0) % 2 ** 31 || 1
}

const pathOf = (drawable: ReturnType<typeof generator.path>) =>
  generator
    .toPaths(drawable)
    .map((path) => path.d)
    .join(' ')

/** A sketchy outline of any path (drawn twice over, like a pen going round again). */
export const sketchOutline = (d: string, seed: number) => pathOf(generator.path(d, { ...STYLE.outline, seed }))

/** A sketchy single stroke along a path (links, axes). */
export const sketchLine = (d: string, seed: number) => pathOf(generator.path(d, { ...STYLE.line, seed }))

export const sketchCircle = (r: number, seed: number) => pathOf(generator.ellipse(0, 0, r * 2, r * 2, { ...STYLE.outline, seed }))

export function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.min(r, w / 2, h / 2)
  return `M ${x + k} ${y} H ${x + w - k} A ${k} ${k} 0 0 1 ${x + w} ${y + k} V ${y + h - k} A ${k} ${k} 0 0 1 ${x + w - k} ${y + h} H ${x + k} A ${k} ${k} 0 0 1 ${x} ${y + h - k} V ${y + k} A ${k} ${k} 0 0 1 ${x + k} ${y} Z`
}

export const pathLength = (d: string) => new svgPathProperties(d).getTotalLength()

/** Shows the first `progress` (0..1) of a stroke of the given length. */
export function reveal(path: SVGElement, length: number, progress: number): void {
  path.setAttribute('stroke-dasharray', `${length} ${length}`)
  path.setAttribute('stroke-dashoffset', String(length * (1 - progress)))
}
