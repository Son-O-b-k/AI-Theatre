// Run with `npm test`. The content check is the only way drawings get into the app, so it must keep
// out anything unsafe, turn colours into tints, and explain every mistake in plain words.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import type { ArtNode } from '../src/scene/library'
import { compileContent } from './content'

const SVG = (body: string, root = 'viewBox="0 0 200 200" fill="none" stroke="#000" stroke-width="4"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`

/** A drawing's own shapes, inside the trim that moves it to the top left. */
const shapes = (nodes: ArtNode[]) => (nodes.length === 1 && nodes[0].tag === 'g' && /^translate/.test(String(nodes[0].attrs.transform)) ? nodes[0].children! : nodes)

function folder(icons: Record<string, string>, drawings: Record<string, string>, entries?: Record<string, object>) {
  const dir = mkdtempSync(join(tmpdir(), 'content-'))
  mkdirSync(join(dir, 'illustrations'))
  writeFileSync(join(dir, 'icons.json'), JSON.stringify(icons))
  for (const [name, svg] of Object.entries(drawings)) writeFileSync(join(dir, 'illustrations', `${name}.svg`), svg)
  const meta = entries ?? Object.fromEntries(Object.keys(drawings).map((name) => [name, { about: `a ${name}`, credit: 'Test' }]))
  writeFileSync(join(dir, 'illustrations', 'illustrations.json'), JSON.stringify(meta))
  return compileContent(dir)
}

describe('content check', () => {
  test('icons are picked from Lucide by name', () => {
    const { library, errors } = folder({ heart: 'heart', 'chart-bar': 'chart-column' }, {})
    assert.deepEqual(errors, [])
    assert.deepEqual(Object.keys(library.icons), ['heart', 'chart-bar'])
    assert.equal(library.icons.heart[0][0], 'path')
  })

  test('a drawing keeps its shapes; colours become tints and lines are measured', () => {
    const { library, errors } = folder({}, {
      cell: SVG(`
        <g transform="translate(10 0)" stroke-width="6">
          <circle cx="50" cy="50" r="40" fill="#ffffff"/>
          <rect x="0" y="0" width="10" height="20" style="fill: #000; stroke: none"/>
        </g>
        <line x1="0" y1="0" x2="30" y2="40"/>`),
    })
    assert.deepEqual(errors, [])
    const art = library.illustrations.cell
    const [group, line] = shapes(art.nodes)
    const [circle, rect] = group.children!
    assert.equal(group.attrs.transform, 'translate(10 0)')
    assert.deepEqual(circle.attrs, { cx: '50', cy: '50', r: '40', 'stroke-width': '6' })
    assert.equal(circle.fill, 0.12) // white: the lightest tint
    assert.equal(circle.stroke, 1)
    assert.ok(Math.abs(circle.length! - 2 * Math.PI * 40) < 0.01)
    assert.equal(rect.fill, 1) // black: the full colour
    assert.equal(rect.stroke, undefined)
    assert.equal(line.length, 50)
  })

  test('details drawn in a clear colour become the second colour; greys stay the main one', () => {
    const { library, errors } = folder({}, {
      lamp: SVG(`
        <rect x="0" y="0" width="50" height="50" fill="#ccc"/>
        <circle cx="25" cy="25" r="10" fill="#f80" stroke="none"/>
        <circle cx="25" cy="25" r="5" fill="#fc8" stroke="#2563eb"/>`),
    })
    assert.deepEqual(errors, [])
    const [card, vivid, pale] = shapes(library.illustrations.lamp.nodes)
    assert.equal(card.accentFill, undefined)
    assert.equal(card.accentStroke, undefined)
    assert.deepEqual([vivid.accentFill, vivid.fill], [true, 1])
    assert.equal(pale.accentFill, true)
    assert.ok(pale.fill! > 0.3 && pale.fill! < 0.6, `a pale accent is a light wash, not ${pale.fill}`)
    assert.equal(pale.accentStroke, true)
  })

  test('a drawing is trimmed to what is drawn, so it takes no empty room and arrows meet it', () => {
    const { library, errors } = folder({}, {
      small: SVG('<rect x="80" y="60" width="40" height="80" fill="#ccc"/>'),
      turned: SVG('<rect x="90" y="40" width="20" height="40" transform="rotate(90 100 100)" fill="#ccc"/>'),
      arc: SVG('<path d="M56 150h92a32 32 0 0 0 2-64 46 46 0 0 0-88-8 36 36 0 0 0-6 72z"/>'),
    })
    assert.ok(errors.some((error) => /^arc\.svg: a path cannot be measured/.test(error)), errors.join('\n'))
    assert.ok(errors.every((error) => error.startsWith('arc.svg')))
    // 40 x 80 plus the line (4 wide) and 2 of room on every side.
    assert.deepEqual([library.illustrations.small.width, library.illustrations.small.height], [48, 88])
    assert.equal(library.illustrations.small.nodes[0].attrs.transform, 'translate(-76 -56)')
    // Turned on its side, it is wide rather than tall.
    assert.deepEqual([library.illustrations.turned.width, library.illustrations.turned.height], [48, 28])
  })

  test('nothing unsafe gets through: scripts, links and handlers', () => {
    const { library, errors } = folder({}, {
      sneaky: SVG(`<script>alert(1)</script><a href="https://example.com"><path d="M0 0L10 10"/></a>
        <path d="M0 0L20 20" onclick="alert(1)" href="javascript:alert(1)" class="x"/>`),
    })
    assert.deepEqual(errors, ['sneaky.svg: <script> is not supported. Use paths and basic shapes (convert text to outlines, ungroup symbols).', 'sneaky.svg: <a> is not supported. Use paths and basic shapes (convert text to outlines, ungroup symbols).'])
    assert.doesNotMatch(JSON.stringify(library), /onclick|href|javascript|class/)
  })

  test('mistakes are explained', () => {
    const { errors } = folder(
      { star: 'not-an-icon', 'Bad Name': 'heart' },
      {
        words: SVG('<text x="0" y="0">Hi</text>'),
        styled: SVG('<style>.a { fill: red }</style><path class="a" d="M0 0L5 5"/>'),
        unsized: SVG('<path d="M0 0L5 5"/>', 'stroke="#000"'),
        orphan: SVG('<path d="M0 0L5 5"/>'),
      },
      { words: { about: 'words', credit: 'Test' }, styled: { about: 'styled', credit: 'Test' }, unsized: { about: '', credit: '' }, ghost: { about: 'x', credit: 'x' } },
    )
    const expected = [
      /"not-an-icon" is not a Lucide icon/,
      /"Bad Name" is not a valid name/,
      /"ghost" has no file ghost.svg/,
      /orphan.svg: add an entry for "orphan"/,
      /<style> block/,
      /unsized" needs "about"/,
      /unsized" needs "credit"/,
      /unsized.svg: needs a viewBox/,
      /words.svg: <text> is not supported/,
    ]
    for (const pattern of expected) assert.ok(errors.some((error) => pattern.test(error)), `expected an error matching ${pattern}:\n${errors.join('\n')}`)
  })

  test('the real content folder is valid', () => {
    assert.deepEqual(compileContent('content').errors, [])
  })
})
