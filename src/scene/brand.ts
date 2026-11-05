// A workspace brand applied to a compiled lesson: its background, its two main colours and its
// logo replace the defaults. Lessons are stored with the default palette and branded when shown,
// so changing or removing the brand restyles every lesson at once.

import type { Brand } from '../../shared/protocol'
import { hexToRgba, rgbaToHex, type Rgba } from './color'
import type { Resolved } from './compile'
import { PALETTE, THEME } from './palette'
import type { TheatreState } from './theatre'

/** Light stages get dark text; dark stages keep the default light text. */
function inkFor(background: string): { text: string; label: string } {
  const { r, g, b } = hexToRgba(background)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.55 ? { text: '#1d1b17', label: '#3d3830' } : { text: THEME.text, label: THEME.label }
}

function colorMap(brand: Brand): Map<string, string> {
  const ink = inkFor(brand.background)
  return new Map([
    [THEME.background, brand.background],
    [THEME.text, ink.text],
    [PALETTE.blue, brand.primary],
    [PALETTE.amber, brand.highlight],
  ])
}

export function brandResolved(resolved: Resolved, brand: Brand | null | undefined): Resolved {
  if (!brand) return resolved
  const map = colorMap(brand)
  const swap = (hex: string) => map.get(hex.toLowerCase()) ?? hex
  return {
    ...resolved,
    background: brand.background,
    ink: inkFor(brand.background),
    logo: brand.logo,
    elements: resolved.elements.map((el) => ({ ...el, color: swap(el.color) })),
    keys: resolved.keys.map((key) => (key.prop === 'color' && typeof key.v === 'string' ? { ...key, v: swap(key.v) } : key)),
  }
}

/** The same swap inside a Theatre project state (its colour keyframes and overrides). */
export function brandTheatreState(state: TheatreState, brand: Brand | null | undefined): TheatreState {
  if (!brand) return state
  const map = colorMap(brand)
  const swap = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || !('r' in value)) return value
    const hex = map.get(rgbaToHex(value as Rgba))
    return hex ? hexToRgba(hex) : value
  }
  return JSON.parse(JSON.stringify(state), (_, value) => swap(value)) as TheatreState
}
