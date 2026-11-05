// resvg needs TrueType fonts; the Inter package ships WOFF. WOFF is TrueType with each table
// zlib-compressed, so unpacking it is a few lines. Converted files are cached in data/fonts.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'

const WEIGHTS = [400, 500, 600, 700]

/** Paths of Inter as TrueType, converting from the npm package the first time. */
export async function interFonts(): Promise<string[]> {
  const dir = join(resolve(process.env.DATA_DIR ?? 'data'), 'fonts')
  const files = await Promise.all(
    WEIGHTS.map(async (weight) => {
      const out = join(dir, `inter-${weight}.ttf`)
      if (!existsSync(out)) {
        const woff = createRequire(import.meta.url).resolve(`@fontsource/inter/files/inter-latin-${weight}-normal.woff`)
        await mkdir(dirname(out), { recursive: true })
        await writeFile(out, woffToTtf(await readFile(woff)))
      }
      return out
    }),
  )
  return files
}

export function woffToTtf(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('Not a WOFF font')
  const numTables = woff.readUInt16BE(12)
  const tables = Array.from({ length: numTables }, (_, i) => {
    const at = 44 + i * 20
    const offset = woff.readUInt32BE(at + 4)
    const compLength = woff.readUInt32BE(at + 8)
    const origLength = woff.readUInt32BE(at + 12)
    const raw = woff.subarray(offset, offset + compLength)
    return {
      tag: woff.subarray(at, at + 4),
      checksum: woff.readUInt32BE(at + 16),
      data: compLength < origLength ? inflateSync(raw) : raw,
    }
  })
  const pad = (n: number) => (n + 3) & ~3
  const headerSize = 12 + numTables * 16
  const out = Buffer.alloc(headerSize + tables.reduce((sum, t) => sum + pad(t.data.length), 0))
  const power = 2 ** Math.floor(Math.log2(numTables))
  out.writeUInt32BE(woff.readUInt32BE(4), 0) // flavor
  out.writeUInt16BE(numTables, 4)
  out.writeUInt16BE(power * 16, 6)
  out.writeUInt16BE(Math.log2(power), 8)
  out.writeUInt16BE(numTables * 16 - power * 16, 10)
  let offset = headerSize
  tables.forEach((table, i) => {
    const at = 12 + i * 16
    table.tag.copy(out, at)
    out.writeUInt32BE(table.checksum, at + 4)
    out.writeUInt32BE(offset, at + 8)
    out.writeUInt32BE(table.data.length, at + 12)
    table.data.copy(out, offset)
    offset += pad(table.data.length)
  })
  return out
}
