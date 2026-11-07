// Run with `npm test`. The content check is the only way drawings get into the app, so it must keep
// out anything unsafe, turn colours into tints, and explain every mistake in plain words.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { compileContent } from './content'

const SVG = (body: string, root = 'viewBox="0 0 200 200" fill="none" stroke="#000" stroke-width="4"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`

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
    assert.deepEqual([art.width, art.height], [200, 200])
    const [group, line] = art.nodes
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
