// Named colours tuned for a dark stage. The AI picks names; hex is accepted too.

export const PALETTE = {
  blue: '#60a5fa',
  sky: '#38bdf8',
  teal: '#2dd4bf',
  green: '#4ade80',
  lime: '#a3e635',
  amber: '#fbbf24',
  orange: '#fb923c',
  red: '#f87171',
  pink: '#f472b6',
  purple: '#a78bfa',
  slate: '#94a3b8',
  white: '#f1f5f9',
} as const

export type ColorName = keyof typeof PALETTE

export const THEME = {
  background: '#0b1124',
  text: '#f1f5f9',
  label: '#cbd5e1',
  link: PALETTE.slate,
  accent: PALETTE.blue,
} as const

/** Common colour words models use that are not in the palette, mapped to the closest one. */
const ALIASES: Record<string, ColorName> = {
  yellow: 'amber',
  gold: 'amber',
  gray: 'slate',
  grey: 'slate',
  black: 'slate',
  silver: 'slate',
  cyan: 'sky',
  aqua: 'teal',
  turquoise: 'teal',
  indigo: 'purple',
  violet: 'purple',
  magenta: 'pink',
  brown: 'orange',
}

/** A palette name or "#rrggbb" for anything recognisable, otherwise undefined. */
export function toColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim().toLowerCase()
  if (name in PALETTE || /^#[0-9a-f]{6}$/.test(name)) return name
  return ALIASES[name]
}

/** Resolves a palette name or hex to hex. */
export const toHex = (value: string): string => PALETTE[value as ColorName] ?? value
