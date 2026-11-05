// Draws a lesson's frames as images, in a worker thread so a long export never blocks the server.
// The stage is the app's own SvgStage on a server-side DOM (linkedom); each frame's values come
// from the lesson's Theatre state (src/scene/sample.ts), so the video matches playback, Studio edits
// included. Frames that look the same as the previous one are not rasterised again.

import { Resvg } from '@resvg/resvg-js'
import { parseHTML } from 'linkedom'
import type { Brand } from '../../shared/protocol'
import { brandResolved, brandTheatreState } from '../../src/scene/brand'
import { compile } from '../../src/scene/compile'
import { sampleAt } from '../../src/scene/sample'
import { STAGE, type Scene } from '../../src/scene/schema'
import type { TheatreState } from '../../src/scene/theatre'

export const FPS = 30

export const chapterFrames = (duration: number) => Math.ceil(duration * FPS)

export interface FrameChapter {
  scene: Scene
  theatreState: TheatreState
}

const escapeXml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** The caption box at the bottom of the frame, as in the player. */
function captionSvg(text: string): string {
  if (!text) return ''
  const size = 24
  const maxChars = 70
  const lines: string[] = []
  for (const word of text.split(/\s+/)) {
    const last = lines.at(-1)
    if (last !== undefined && (last + ' ' + word).length <= maxChars) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  const height = lines.length * size * 1.3 + 20
  const width = Math.min(STAGE.width * 0.86, Math.max(...lines.map((l) => l.length)) * size * 0.52 + 40)
  const y = STAGE.height * 0.95 - height
  const tspans = lines.map((line, i) => `<tspan x="${STAGE.width / 2}" y="${y + 10 + size * 1.05 + i * size * 1.3}">${escapeXml(line)}</tspan>`).join('')
  return `<rect x="${(STAGE.width - width) / 2}" y="${y}" width="${width}" height="${height}" rx="10" fill="#000" fill-opacity="0.66"/>
<text font-family="Inter" font-size="${size}" font-weight="500" fill="#f3f0e8" text-anchor="middle">${tspans}</text>`
}

export interface RenderOptions {
  chapters: FrameChapter[]
  brand: Brand | null
  captions: boolean
  fontFiles: string[]
  /** The range of frames to draw, counted across the whole lesson (workers split it). */
  from: number
  to: number
  /** Receives each frame's RGBA pixels (STAGE.width × STAGE.height × 4 bytes). */
  onFrame(pixels: Uint8Array): Promise<void>
  onProgress(done: number, total: number): void
}

export async function renderFrames(options: RenderOptions): Promise<void> {
  // SvgStage builds its nodes with `document`, so this runs only in a worker with its own globals.
  const { document } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>')
  ;(globalThis as { document?: unknown }).document = document
  const { SvgStage } = await import('../../src/stage/SvgStage')

  const resolvedChapters = options.chapters.map((chapter) => ({
    resolved: brandResolved(compile(chapter.scene), options.brand),
    state: brandTheatreState(chapter.theatreState, options.brand),
  }))
  const total = options.to - options.from
  let done = 0
  let previous = ''
  let pixels: Uint8Array = new Uint8Array(0)
  let first = 0 // the lesson-wide number of the chapter's first frame

  for (const { resolved, state } of resolvedChapters) {
    const frames = chapterFrames(resolved.duration)
    const from = Math.max(options.from, first) - first
    const to = Math.min(options.to, first + frames) - first
    first += frames
    if (from >= to) continue
    const host = document.getElementById('host') as unknown as HTMLElement
    host.innerHTML = ''
    const stage = new SvgStage(host)
    stage.render(resolved)
    for (let frame = from; frame < to; frame++) {
      const t = frame / FPS
      for (const [id, visual] of sampleAt(resolved, state, t)) stage.update(id, visual)
      const cue = [...resolved.cues].reverse().find((c) => c.t <= t)
      // resvg does not resolve CSS variables, so the label halo gets its colour directly.
      const svg = stage.svg.outerHTML
        .replace(/var\(--stage-bg\)/g, resolved.background)
        .replace(/<\/svg>$/, `${options.captions && cue ? captionSvg(cue.text) : ''}</svg>`)
      if (svg !== previous) {
        const rendered = new Resvg(svg, {
          fitTo: { mode: 'width', value: STAGE.width },
          font: { fontFiles: options.fontFiles, loadSystemFonts: true, defaultFontFamily: 'Inter' },
        }).render()
        pixels = rendered.pixels
        previous = svg
      }
      await options.onFrame(pixels)
      options.onProgress(++done, total)
    }
    stage.destroy()
  }
}
