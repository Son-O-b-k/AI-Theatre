// Run with `npm test`. How the stage draws the diagram pieces: two-tone drawings, status badges,
// window frames and blocked links. Drawn on a server-side DOM, as the video export does.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseHTML } from 'linkedom'
import { compile } from '../scene/compile'
import { PALETTE } from '../scene/palette'
import { applyOp, emptyScene, finalizeScene } from '../scene/scene'
import { parseOp, type Scene } from '../scene/schema'

const { document } = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>')
;(globalThis as { document?: unknown }).document = document
const { SvgStage } = await import('./SvgStage')

function stage(lines: object[], look?: Scene['look']): { svg: SVGSVGElement; scene: Scene } {
  let scene: Scene = { ...emptyScene(), look }
  for (const line of lines) scene = applyOp(scene, parseOp(line), (message) => assert.fail(message))
  scene = finalizeScene(scene)
  const resolved = compile(scene)
  const drawn = new SvgStage(document.getElementById('host') as unknown as HTMLElement)
  drawn.render(resolved)
  // Everything as it is at the end of the chapter.
  for (const el of resolved.elements) drawn.update(el.id, { ...el, opacity: 1, draw: 1 })
  return { svg: drawn.svg, scene }
}

const node = (svg: SVGSVGElement, id: string) => svg.querySelector(`[data-id="${id}"]`)!

describe('diagram pieces', () => {
  test("a drawing's details take its second colour: amber on cool lines, the lesson's choice otherwise", () => {
    const { svg, scene } = stage([
      { op: 'board', title: 'Data' },
      { op: 'el', id: 'db', kind: 'illustration', art: 'database', label: 'Orders', color: 'blue' },
      { op: 'el', id: 'web', kind: 'illustration', art: 'browser', label: 'Shop', accent: 'green' },
      { op: 'beat', say: 'The shop keeps its orders in a database.', do: [{ show: ['db', 'web'] }] },
    ])
    assert.match(node(svg, 'db').outerHTML, new RegExp(`fill="${PALETTE.amber}"`))
    assert.match(node(svg, 'web').outerHTML, new RegExp(`fill="${PALETTE.green}"`))
    const web = scene.elements.find((el) => el.id === 'web')
    assert.equal(web?.kind === 'illustration' && web.accent, PALETTE.green, 'stored as the colour itself')
  })

  test('badges, window frames and blocked links are understood however models write them', () => {
    const { svg } = stage([
      { op: 'board', title: 'Listening on localhost', layout: 'flow' },
      { op: 'el', id: 'app', kind: 'illustration', art: 'browser', label: 'App', status: 'up' },
      { op: 'el', id: 'port', kind: 'illustration', art: 'network-port', label: '127.0.0.1' },
      { op: 'el', id: 'server', kind: 'window', label: 'App server', contains: ['app', 'port'] },
      { op: 'el', id: 'other', kind: 'illustration', art: 'laptop', label: 'Other machine', mark: 'question' },
      { op: 'link', id: 'in', from: 'app', to: 'port' },
      { op: 'link', id: 'out', from: 'port', to: 'other', blocked: true },
      { op: 'beat', say: 'The app only listens on localhost, so the other machine cannot reach it.', do: [{ show: ['server', 'other', 'in', 'out'] }] },
    ])
    assert.equal(node(svg, 'app').querySelector('[data-mark]')!.getAttribute('data-mark'), 'ok')
    assert.equal(node(svg, 'other').querySelector('[data-mark]')!.getAttribute('data-mark'), 'ask')
    assert.equal(node(svg, 'port').querySelector('[data-mark]'), null)
    const frame = node(svg, 'server')
    assert.equal(frame.querySelector('text')!.textContent, 'APP SERVER')
    assert.equal(frame.querySelectorAll('circle').length, 3, 'three dots on the title bar')
    assert.doesNotMatch(frame.outerHTML, /stroke-dasharray/)
    const blocked = node(svg, 'out').querySelector('[data-mark]')!
    assert.equal(blocked.getAttribute('data-mark'), 'no')
    assert.equal(blocked.getAttribute('visibility'), 'visible')
    assert.equal(node(svg, 'in').querySelector('[data-mark]'), null)
  })

  test("a drawing's level rises inside it; tabs light the current one; tags show under shapes", () => {
    const { svg } = stage([
      { op: 'board', title: 'Data' },
      { op: 'el', id: 'ways', kind: 'tabs', items: ['Hash', 'Range'], current: 'Range' },
      { op: 'el', id: 'db', kind: 'illustration', art: 'database', label: 'Orders', level: 0.25, chip: 'Acme · 50' },
      { op: 'beat', say: 'It is a quarter full.', do: [{ show: ['ways', 'db'] }] },
    ])
    const db = node(svg, 'db')
    const liquid = db.querySelector('[clip-path] rect')!
    const height = Number(liquid.getAttribute('height'))
    const art = Number(liquid.getAttribute('y')) + height
    assert.ok(Math.abs(height / art - 0.25) < 0.01, 'a quarter of the drawing')
    assert.ok(db.querySelector('clipPath')!.children.length > 0, 'clipped to the drawing itself')
    assert.match(db.textContent!, /Acme · 50/)
    const lit = [...node(svg, 'ways').querySelectorAll('rect[fill-opacity="0.22"]')].map((rect) => rect.getAttribute('opacity'))
    assert.deepEqual(lit, ['0', '1'])
  })

  test('the marker look letters labels in capitals, fitted to the room the layout gave them', () => {
    const lines = [
      { op: 'board', title: 'Data' },
      { op: 'el', id: 'db', kind: 'illustration', art: 'database', label: 'Orders' },
      { op: 'beat', say: 'A database.', do: [{ show: 'db' }] },
    ]
    const chalk = node(stage(lines).svg, 'db').querySelector('text')!
    const marker = node(stage(lines, 'marker').svg, 'db').querySelector('text')!
    assert.equal(chalk.textContent, 'Orders')
    assert.equal(chalk.getAttribute('textLength'), null)
    assert.equal(marker.textContent, 'ORDERS')
    assert.match(marker.getAttribute('font-family')!, /Gochi Hand/)
    assert.ok(Number(marker.getAttribute('textLength')) > 0)
  })
})
