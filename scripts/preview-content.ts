// Draws every illustration the way lessons show it, on the stage's board, into
// content/illustrations/preview.png. Run `npm run preview:content` after adding a drawing to check
// how it looks before the AI uses it.

import { writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { parseHTML } from 'linkedom'
import { stageFonts } from '../server/exports/fonts'
import { ILLUSTRATION_NAMES } from '../src/scene/library'
import { PALETTE, THEME } from '../src/scene/palette'
import type { SceneElement } from '../src/scene/schema'

const OUTPUT = 'content/illustrations/preview.png'
const CELL = { width: 300, height: 300 }
const COLUMNS = 4
const COLORS = [PALETTE.white, PALETTE.blue, PALETTE.amber, PALETTE.teal, PALETTE.red, PALETTE.green]

const { document } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as { document?: unknown }).document = document
const { buildShape } = await import('../src/stage/elements')
const { create } = await import('../src/stage/svg')

const rows = Math.ceil(ILLUSTRATION_NAMES.length / COLUMNS)
const width = COLUMNS * CELL.width
const height = rows * CELL.height
const svg = create('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, 'font-family': 'Inter' })
svg.append(create('rect', { width, height, fill: THEME.background }))

ILLUSTRATION_NAMES.forEach((art, i) => {
  const el = { id: art, kind: 'illustration', art, size: 190, label: art, color: COLORS[i % COLORS.length] } as unknown as SceneElement
  const part = buildShape(el, { text: THEME.text, label: THEME.label })
  part.draw?.(1)
  const x = (i % COLUMNS) * CELL.width + CELL.width / 2
  const y = Math.floor(i / COLUMNS) * CELL.height + CELL.height / 2 - 18
  part.root.setAttribute('transform', `translate(${x} ${y})`)
  part.root.setAttribute('color', String(el.color))
  svg.append(part.root)
})

const markup = svg.outerHTML.replace(/var\(--stage-bg\)/g, THEME.background)
const png = new Resvg(markup, { font: { fontFiles: await stageFonts(), loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng()
writeFileSync(OUTPUT, png)
console.log(`Drew ${ILLUSTRATION_NAMES.length} illustrations into ${OUTPUT}`)
