// Measurements of the richer elements (illustrations, charts, counters, timelines, tables), shared
// by the layout engine, the layout check and the stage so they all agree on sizes. Everything is
// relative to the element's centre and unscaled.

import { textWidth, wrapText } from './text'
import { ILLUSTRATIONS } from './library'
import type { ElementOf } from './schema'

// ── Illustration ────────────────────────────────────────────────────────────

/** The drawing's size on stage: its longer side is `size`. */
export function artSize(el: ElementOf<'illustration'>): { w: number; h: number } {
  const art = ILLUSTRATIONS[el.art]
  const aspect = art ? art.width / art.height : 1
  return aspect >= 1 ? { w: el.size, h: el.size / aspect } : { w: el.size * aspect, h: el.size }
}

// ── Chart ───────────────────────────────────────────────────────────────────

export const CHART = { width: 560, height: 300, text: 18, top: 30, bottom: 50 } as const

export interface ChartBar {
  /** Centre of the bar. */
  x: number
  width: number
  /** Full height of the bar. */
  height: number
  value: string
  label: string[]
}

export function chartLayout(el: ElementOf<'chart'>): { baseline: number; bars: ChartBar[] } {
  const slot = CHART.width / el.bars.length
  const width = Math.min(72, slot * 0.62)
  const baseline = CHART.height / 2 - CHART.bottom
  const plot = CHART.height - CHART.top - CHART.bottom
  const max = Math.max(...el.bars.map((bar) => bar.value), 0) || 1
  return {
    baseline,
    bars: el.bars.map((bar, i) => ({
      x: -CHART.width / 2 + slot * (i + 0.5),
      width,
      height: (Math.max(0, bar.value) / max) * plot,
      value: withUnit(formatNumber(bar.value, bar.value % 1 === 0 ? 0 : 1), el.unit),
      label: wrapText(bar.label, CHART.text, slot - 8).slice(0, 2),
    })),
  }
}

/** Currency symbols go before the number ($12), other units after it (12%, 12 kg). */
function withUnit(value: string, unit = ''): string {
  if (/^[$€£¥₹₦]$/.test(unit)) return `${unit}${value}`
  return /^[%°]/.test(unit) || unit === '' ? `${value}${unit}` : `${value} ${unit}`
}

// ── Counter ─────────────────────────────────────────────────────────────────

/** Thousands separated, fixed decimals: 12,500 or 3.14. */
export function formatNumber(value: number, decimals: number): string {
  const [whole, fraction] = Math.abs(value).toFixed(decimals).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${value < 0 ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

/** What the counter shows when its count is `progress` (0..1) of the way there. */
export function counterText(el: ElementOf<'counter'>, progress: number): string {
  const eased = 1 - (1 - progress) ** 3
  return `${el.prefix}${formatNumber(el.from + (el.to - el.from) * eased, el.decimals)}${el.suffix}`
}

export function counterExtent(el: ElementOf<'counter'>): { hw: number; hh: number } {
  const longest = Math.max(counterText(el, 0).length, counterText(el, 1).length)
  return { hw: (longest * el.size * 0.62) / 2, hh: el.size * 0.6 }
}

// ── Timeline ────────────────────────────────────────────────────────────────

export const TIMELINE = { slot: 170, minWidth: 480, maxWidth: 1100, at: 21, text: 18, above: 26, below: 30 } as const

export function timelineLayout(el: ElementOf<'timeline'>): { width: number; points: { x: number; at: string; label: string[] }[] } {
  const width = Math.min(TIMELINE.maxWidth, Math.max(TIMELINE.minWidth, el.points.length * TIMELINE.slot))
  const slot = width / el.points.length
  return {
    width,
    points: el.points.map((point, i) => ({
      x: -width / 2 + slot * (i + 0.5),
      at: point.at,
      label: point.label ? wrapText(point.label, TIMELINE.text, slot - 12).slice(0, 3) : [],
    })),
  }
}

export function timelineExtent(el: ElementOf<'timeline'>): { hw: number; hh: number } {
  const lines = Math.max(1, ...timelineLayout(el).points.map((point) => point.label.length))
  return { hw: timelineLayout(el).width / 2 + 8, hh: TIMELINE.below + lines * TIMELINE.text * 1.25 }
}

// ── Table ───────────────────────────────────────────────────────────────────

export const TABLE = { text: 19, row: 44, pad: 16, minColumn: 84, maxColumn: 300 } as const

export function tableLayout(el: ElementOf<'table'>): { columns: number[]; width: number; height: number; cells: string[][] } {
  const cells = [el.columns, ...el.rows].map((row) => el.columns.map((_, i) => row[i] ?? ''))
  const columns = el.columns.map((_, i) => {
    const widest = Math.max(...cells.map((row) => textWidth(row[i], TABLE.text)))
    return Math.min(TABLE.maxColumn, Math.max(TABLE.minColumn, widest + TABLE.pad * 2))
  })
  return { columns, width: columns.reduce((sum, w) => sum + w, 0), height: cells.length * TABLE.row, cells }
}

// ── Group ───────────────────────────────────────────────────────────────────

/** Space between a group's frame and the shapes inside, and the room its label takes at the top. */
export const GROUP = { pad: 26, label: 42, text: 25 } as const
