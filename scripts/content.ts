// Checks the content folder and compiles it into src/scene/library.generated.json, which the app
// (and the video renderer) read. Run `npm run check:content` after adding or changing an icon or an
// illustration; dev, build and test run it first, so a broken file is reported straight away.
//
// Illustrations are rebuilt from an allowlist: only basic shapes, paths and groups, with their
// geometry and line style, make it into the app. Scripts, links, images, text and styles never do.
// Colours become tints of the element's colour (see content/README.md), so drawings follow the
// lesson's colours and a workspace's brand, and every line is measured so it can be drawn in.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { icons as lucide } from 'lucide'
import { DOMParser } from 'linkedom'
import { svgPathProperties } from 'svg-path-properties'
import type { ArtNode, Library } from '../src/scene/library'

const OUTPUT = 'src/scene/library.generated.json'
const NAME = /^[a-z][a-z0-9-]{0,47}$/

const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
/** Editor leftovers that draw nothing; skipped quietly. */
const SKIPPED = new Set(['title', 'desc', 'metadata', 'defs'])
const GEOMETRY = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2']
const LINE_STYLE = ['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'fill-rule']
const TRANSFORM = /^[\s\d.,eE+-]*((matrix|translate|scale|rotate|skewX|skewY)\([\s\d.,eE+-]*\)[\s,]*)*$/

type Fail = (message: string) => void

// ── Icons ─────────────────────────────────────────────────────────────────────

const pascal = (kebab: string) => kebab.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())

function compileIcons(dir: string, fail: Fail): Library['icons'] {
  const names = JSON.parse(readFileSync(join(dir, 'icons.json'), 'utf8')) as Record<string, string>
  const out: Library['icons'] = {}
  for (const [name, lucideName] of Object.entries(names)) {
    if (!NAME.test(name)) fail(`icons.json: "${name}" is not a valid name (lowercase letters, digits and -)`)
    const node = lucide[pascal(lucideName) as keyof typeof lucide]
    if (!node) fail(`icons.json: "${lucideName}" is not a Lucide icon (see https://lucide.dev/icons)`)
    else out[name] = node as unknown as Library['icons'][string]
  }
  return out
}

// ── Illustrations ─────────────────────────────────────────────────────────────

interface Paint {
  fill: string
  stroke: string
  fillOpacity: number
  strokeOpacity: number
  opacity: number
  line: Record<string, string>
}

const INITIAL: Paint = { fill: '#000', stroke: 'none', fillOpacity: 1, strokeOpacity: 1, opacity: 1, line: {} }

/** Attributes, with any style="a: b; c: d" declarations taking precedence (as in SVG). */
function attributesOf(node: Element): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const { name, value } of Array.from(node.attributes)) attrs.set(name, value.trim())
  for (const declaration of (attrs.get('style') ?? '').split(';')) {
    const [name, value] = declaration.split(':').map((part) => part?.trim())
    if (name && value) attrs.set(name, value)
  }
  return attrs
}

function inherit(paint: Paint, attrs: Map<string, string>): Paint {
  const number = (name: string, fallback: number) => (attrs.has(name) ? Number.parseFloat(attrs.get(name)!) : fallback)
  const line = { ...paint.line }
  for (const name of LINE_STYLE) if (attrs.has(name)) line[name] = attrs.get(name)!
  return {
    fill: attrs.get('fill') ?? paint.fill,
    stroke: attrs.get('stroke') ?? paint.stroke,
    fillOpacity: number('fill-opacity', paint.fillOpacity),
    strokeOpacity: number('stroke-opacity', paint.strokeOpacity),
    opacity: paint.opacity * number('opacity', 1),
    line,
  }
}

const NAMED: Record<string, string> = { black: '#000', white: '#fff', gray: '#808080', grey: '#808080', silver: '#c0c0c0' }

/** Lightness 0 (black) to 1 (white); colours that cannot be read count as a mid tone. */
function lightness(color: string): number {
  const value = NAMED[color.toLowerCase()] ?? color
  if (/^currentcolor$/i.test(value)) return 0
  let rgb: number[] | undefined
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1]
  if (hex) rgb = (hex.length === 3 ? [...hex].map((c) => c + c) : hex.match(/../g)!).map((h) => Number.parseInt(h, 16))
  const fn = value.match(/^rgba?\(([^)]+)\)$/i)?.[1]
  if (fn) rgb = fn.split(/[\s,/]+/).slice(0, 3).map((part) => Number.parseFloat(part))
  if (!rgb || rgb.some(Number.isNaN)) return 0.5
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** How strongly a fill shows: the darker the colour in the file, the stronger the tint. */
const tint = (paint: Paint) => round(Math.max(0.12, 1 - lightness(paint.fill)) * paint.fillOpacity * paint.opacity)

function lengthOf(tag: string, a: Map<string, string>): number {
  const n = (name: string) => Number.parseFloat(a.get(name) ?? '0') || 0
  const points = () => (a.get('points') ?? '').trim().split(/[\s,]+/).map(Number).reduce<number[][]>((pairs, v, i) => (i % 2 ? pairs[pairs.length - 1].push(v) : pairs.push([v]), pairs), [])
  const polyline = (pts: number[][]) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
  switch (tag) {
    case 'path':
      return new svgPathProperties(a.get('d') ?? '').getTotalLength()
    case 'circle':
      return 2 * Math.PI * n('r')
    case 'ellipse': {
      const [rx, ry] = [n('rx'), n('ry')]
      return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    }
    case 'rect':
      return 2 * (n('width') + n('height'))
    case 'line':
      return Math.hypot(n('x2') - n('x1'), n('y2') - n('y1'))
    case 'polyline':
      return polyline(points())
    case 'polygon': {
      const pts = points()
      return pts.length ? polyline([...pts, pts[0]]) : 0
    }
    default:
      return 0
  }
}

function compileNode(node: Element, paint: Paint, file: string, fail: Fail): ArtNode[] {
  const tag = node.tagName
  if (tag.includes(':') || SKIPPED.has(tag)) return []
  const attrs = attributesOf(node)
  const own = inherit(paint, attrs)
  const transform = attrs.get('transform')
  if (transform && !TRANSFORM.test(transform)) {
    fail(`${file}: unreadable transform "${transform}"`)
    return []
  }
  const placed: Record<string, string> = transform ? { transform } : {}

  if (tag === 'g' || tag === 'svg') {
    const children = Array.from(node.children).flatMap((child) => compileNode(child, own, file, fail))
    return children.length ? [{ tag: 'g', attrs: placed, children }] : []
  }
  if (tag === 'style') {
    fail(`${file}: colours are set in a <style> block, which is not read. Export with colours as attributes (Illustrator: Styling "Presentation Attributes"; Figma and Inkscape do this already).`)
    return []
  }
  if (!SHAPES.has(tag)) {
    fail(`${file}: <${tag}> is not supported. Use paths and basic shapes (convert text to outlines, ungroup symbols).`)
    return []
  }

  const geometry = Object.fromEntries(GEOMETRY.filter((name) => attrs.has(name)).map((name) => [name, attrs.get(name)!]))
  const out: ArtNode = { tag, attrs: { ...geometry, ...placed, ...own.line } }
  if (own.fill !== 'none' && tag !== 'line') out.fill = tint(own)
  if (own.stroke !== 'none') {
    out.stroke = round(own.strokeOpacity * own.opacity)
    out.length = round(lengthOf(tag, attrs))
  }
  return out.fill === undefined && out.stroke === undefined ? [] : [out]
}

interface Entry {
  about?: string
  tags?: string[]
  credit?: string
}

function compileIllustrations(content: string, fail: Fail): Library['illustrations'] {
  const dir = join(content, 'illustrations')
  const entries = JSON.parse(readFileSync(join(dir, 'illustrations.json'), 'utf8')) as Record<string, Entry>
  const files = readdirSync(dir).filter((file) => file.endsWith('.svg'))
  const out: Library['illustrations'] = {}

  for (const name of Object.keys(entries)) {
    if (!files.includes(`${name}.svg`)) fail(`illustrations.json: "${name}" has no file ${name}.svg`)
  }
  for (const file of files) {
    const name = file.slice(0, -4)
    const entry = entries[name]
    if (!NAME.test(name)) fail(`${file}: name files in lowercase letters, digits and - (e.g. plant-cell.svg)`)
    if (!entry) {
      fail(`${file}: add an entry for "${name}" to illustrations.json`)
      continue
    }
    if (!entry.about?.trim()) fail(`illustrations.json: "${name}" needs "about", a short description the AI reads`)
    if (!entry.credit?.trim()) fail(`illustrations.json: "${name}" needs "credit" (who drew it, and the licence)`)

    const root = new DOMParser().parseFromString(readFileSync(join(dir, file), 'utf8'), 'image/svg+xml').documentElement as unknown as Element | null
    if (root?.tagName !== 'svg') {
      fail(`${file}: not an SVG file`)
      continue
    }
    const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    if (box.length !== 4 || box.some(Number.isNaN) || box[2] <= 0 || box[3] <= 0) {
      fail(`${file}: needs a viewBox, e.g. viewBox="0 0 200 200"`)
      continue
    }
    const nodes = Array.from(root.children).flatMap((child) => compileNode(child, inherit(INITIAL, attributesOf(root)), file, fail))
    if (nodes.length === 0) fail(`${file}: draws nothing`)
    const shift = box[0] || box[1] ? [{ tag: 'g', attrs: { transform: `translate(${-box[0]} ${-box[1]})` }, children: nodes }] : nodes
    out[name] = { about: entry.about!.trim(), width: box[2], height: box[3], nodes: shift }
  }
  return out
}

/** Reads a content folder; the library is only usable when there are no errors. */
export function compileContent(dir: string): { library: Library; errors: string[] } {
  const errors: string[] = []
  const fail: Fail = (message) => errors.push(message)
  return { library: { icons: compileIcons(dir, fail), illustrations: compileIllustrations(dir, fail) }, errors }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { library, errors } = compileContent('content')
  if (errors.length > 0) {
    console.error(`Content has ${errors.length} problem${errors.length > 1 ? 's' : ''}:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
    process.exit(1)
  }
  const json = `${JSON.stringify(library)}\n`
  let previous = ''
  try {
    previous = readFileSync(OUTPUT, 'utf8')
  } catch {}
  if (previous !== json) writeFileSync(OUTPUT, json)
  console.log(`Content ok: ${Object.keys(library.icons).length} icons, ${Object.keys(library.illustrations).length} illustrations`)
}
