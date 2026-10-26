/** Theatre.js colour value: sRGB channels in 0..1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export function hexToRgba(hex: string): Rgba {
  const n = parseInt(hex.slice(1), 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 }
}

/** Alpha is dropped: scene colours are opaque; transparency comes from `opacity`. */
export function rgbaToHex({ r, g, b }: Rgba): string {
  const channel = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function rgbaToCss({ r, g, b, a }: Rgba): string {
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}
