// Building SVG node by node rather than from markup, so the case-sensitive SVG names survive on any
// DOM (video export draws on a server-side one, whose HTML parser would lowercase them).

export const SVG_NS = 'http://www.w3.org/2000/svg'

export type Attributes = Record<string, string | number>
export type Tree = [tag: keyof SVGElementTagNameMap, attributes: Attributes, children?: Tree[]]

export function create<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Attributes = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  setAttributes(node, attributes)
  return node
}

export function tree([tag, attributes, children = []]: Tree): SVGElement {
  const node = create(tag, attributes)
  node.append(...children.map(tree))
  return node
}

export function setAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
}

/** A text node with one tspan per line, centred on (0, y). */
export function lines(text: string[], attributes: Attributes, y: number, lineHeight: number): SVGTextElement {
  const node = create('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', ...attributes })
  text.forEach((line, i) => {
    const span = create('tspan', { x: attributes.x ?? 0, y: y + i * lineHeight })
    span.textContent = line
    node.append(span)
  })
  return node
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
