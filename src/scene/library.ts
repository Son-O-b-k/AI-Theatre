// The icons and illustrations the AI may use, compiled from the content folder by
// `npm run check:content` (scripts/content.ts). Add or change them in content/, not here.

import compiled from './library.generated.json'

/** A Lucide icon: flat SVG elements on a 24×24 grid. */
export type IconNode = [tag: string, attributes: Record<string, string | number>][]

/**
 * A part of an illustration. Shapes carry how strongly they are filled (a tint of the element's
 * colour, 0..1) and outlined, and the length of their outline so it can be drawn in.
 */
export interface ArtNode {
  tag: string
  attrs: Record<string, string | number>
  fill?: number
  stroke?: number
  length?: number
  children?: ArtNode[]
}

export interface Art {
  /** What it shows, for the AI. */
  about: string
  width: number
  height: number
  nodes: ArtNode[]
}

export interface Library {
  icons: Record<string, IconNode>
  illustrations: Record<string, Art>
}

const library = compiled as unknown as Library

export const ICONS = library.icons
export const ICON_NAMES = Object.keys(ICONS).sort()
export const ICON_GRID = 24

export const ILLUSTRATIONS = library.illustrations
export const ILLUSTRATION_NAMES = Object.keys(ILLUSTRATIONS).sort()
