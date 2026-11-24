// Creators' pictures: uploaded, or imported from Openverse (openly licensed images that may be used
// commercially and adapted). Stored once by content, like narration clips:
//   data/images/<hash>.<ext>
// and served publicly at /api/images/<hash>.<ext> so share pages, embeds and exports can show
// them. The name is a hash of the picture, so it cannot be guessed without having the picture.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import type { ImageSearchResult, StoredImage } from '../shared/protocol'
import { IMAGE_URL } from '../src/scene/schema'

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
/** Larger pictures are scaled down: a lesson never shows one bigger than the stage. */
const MAX_SIDE = 1920
const KEEP_BYTES = 2.5 * 1024 * 1024

export class ImageError extends Error {}

type Format = 'png' | 'jpg' | 'webp' | 'gif'

const TYPES: Record<Format, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

const dir = () => join(resolve(process.env.DATA_DIR ?? 'data'), 'images')
export const imageFile = (name: string) => join(dir(), name)
export const imageType = (name: string) => TYPES[name.split('.').pop() as Format] ?? 'application/octet-stream'

/** The picture's format, from its first bytes rather than its name. */
export function formatOf(data: Uint8Array): Format | null {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => data[i] === byte)
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'png'
  if (starts(0xff, 0xd8, 0xff)) return 'jpg'
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') return 'webp'
  return null
}

/** Width and height from the file's header, without decoding it. */
export function sizeOf(data: Uint8Array, format: Format): { width: number; height: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  try {
    switch (format) {
      case 'png':
        return { width: view.getUint32(16), height: view.getUint32(20) }
      case 'gif':
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
      case 'webp': {
        const chunk = String.fromCharCode(...data.slice(12, 16))
        if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
        if (chunk === 'VP8L') {
          const bits = view.getUint32(21, true)
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
        }
        if (chunk === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) }
        return null
      }
      case 'jpg': {
        // Walk the segments to the frame header (SOF0..SOF15, except DHT, JPG and DAC).
        let at = 2
        while (at + 9 < data.length) {
          if (data[at] !== 0xff) return null
          const marker = data[at + 1]
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) }
          }
          at += 2 + view.getUint16(at + 2)
        }
        return null
      }
    }
  } catch {
    return null
  }
}

/** Scales a picture down with ffmpeg (shipped for video export). Photos stay JPEG; the rest become PNG. */
async function scaledDown(data: Uint8Array, format: Format): Promise<Uint8Array | null> {
  const work = join(tmpdir(), `ai-theatre-image-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const output = `${work}.out.${format === 'jpg' ? 'jpg' : 'png'}`
  try {
    await writeFile(work, data)
    const scale = `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease`
    const child = spawn(ffmpegInstaller.path, ['-y', '-loglevel', 'error', '-i', work, '-vf', scale, '-frames:v', '1', ...(format === 'jpg' ? ['-q:v', '3'] : []), output])
    const [code] = await once(child, 'close')
    return code === 0 ? new Uint8Array(await readFile(output)) : null
  } catch {
    return null
  } finally {
    await rm(work, { force: true })
    await rm(output, { force: true })
  }
}

/** Stores a picture (scaled down if it is very large) and says where it is served. */
export async function saveImage(input: Uint8Array, credit?: string): Promise<StoredImage> {
  if (input.byteLength > MAX_IMAGE_BYTES) throw new ImageError('The picture must be under 15 MB.')
  let format = formatOf(input)
  if (!format) throw new ImageError('Use a PNG, JPEG, WebP or GIF picture.')
  let data = input
  let size = sizeOf(data, format)
  if (!size) throw new ImageError('Could not read this picture. Is it damaged?')
  if (Math.max(size.width, size.height) > MAX_SIDE || data.byteLength > KEEP_BYTES) {
    const smaller = await scaledDown(data, format)
    const smallerFormat = smaller && formatOf(smaller)
    const smallerSize = smallerFormat && sizeOf(smaller, smallerFormat)
    if (smaller && smallerFormat && smallerSize && smaller.byteLength < data.byteLength) {
      data = smaller
      format = smallerFormat
      size = smallerSize
    }
  }
  const name = `${createHash('sha256').update(data).digest('hex').slice(0, 16)}.${format}`
  await mkdir(dir(), { recursive: true })
  await writeFile(imageFile(name), data)
  return { url: `/api/images/${name}`, ...size, ...(credit && { credit }) }
}

/** The stored pictures a scene shows, for exports that carry their own copies. */
export function imageUrls(scenes: unknown[]): string[] {
  const urls = new Set<string>()
  for (const scene of scenes) {
    for (const el of (scene as { elements?: { kind: string; src?: string }[] }).elements ?? []) {
      if (el.kind === 'photo' && el.src && IMAGE_URL.test(el.src)) urls.add(el.src)
    }
  }
  return [...urls]
}

export const readImage = (url: string) => readFile(imageFile(url.split('/').pop()!)).catch(() => null)

// ── Openverse ───────────────────────────────────────────────────────────────

const OPENVERSE = 'https://api.openverse.org/v1/images'

/**
 * Some image hosts (Wikimedia) refuse downloads from programs that give no way to reach whoever runs
 * them. IMAGE_FETCH_CONTACT (a website or email, in .env) is sent with downloads; without it those
 * hosts are left out of searches rather than offering pictures that would fail.
 */
const contact = () => process.env.IMAGE_FETCH_CONTACT?.trim()
const userAgent = () => (contact() ? `AI-Theatre/1.0 (${contact()})` : 'AI-Theatre/1.0')
const NEEDS_CONTACT = ['wikimedia']

const get = (url: string, timeout: number) =>
  fetch(url, { headers: { 'user-agent': userAgent(), accept: 'application/json, image/*' }, signal: AbortSignal.timeout(timeout) }).catch(() => null)

interface OpenverseImage {
  id: string
  title?: string
  url: string
  thumbnail?: string
  width?: number
  height?: number
  creator?: string
  license: string
  license_version?: string
  foreign_landing_url?: string
}

/** "Onion cells by kaibara87 (CC BY 2.0)": what the licence asks to be shown with the picture. */
export function creditOf(image: Pick<OpenverseImage, 'title' | 'creator' | 'license' | 'license_version'>): string {
  const license =
    image.license === 'pdm' ? 'Public domain' : image.license === 'cc0' ? 'CC0' : `CC ${image.license.toUpperCase()}${image.license_version ? ` ${image.license_version}` : ''}`
  const title = image.title?.trim().slice(0, 60)
  const by = image.creator ? `${title ? `${title} by ` : ''}${image.creator.trim().slice(0, 40)}` : (title ?? 'Openverse')
  return `${by} (${license})`
}

/** Pictures anyone may use commercially and change, for a search like "onion cells". */
export async function searchImages(query: string): Promise<ImageSearchResult[]> {
  const params = new URLSearchParams({ q: query, page_size: '20', license_type: 'commercial,modification', mature: 'false' })
  if (!contact()) params.set('excluded_source', NEEDS_CONTACT.join(','))
  const response = await get(`${OPENVERSE}/?${params}`, 10_000)
  if (!response?.ok) throw new ImageError('The free picture library is not answering right now. Try again in a minute.')
  const { results } = (await response.json()) as { results: OpenverseImage[] }
  return results.map((image) => ({
    id: image.id,
    title: image.title ?? '',
    thumbnail: image.thumbnail ?? `${OPENVERSE}/${image.id}/thumb/`,
    width: image.width,
    height: image.height,
    credit: creditOf(image),
    page: image.foreign_landing_url ?? `https://openverse.org/image/${image.id}`,
  }))
}

/** Copies a picture from the library into the app, with its credit. */
export async function importImage(id: string): Promise<StoredImage> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ImageError('No such picture.')
  const details = await get(`${OPENVERSE}/${id}/`, 10_000)
  if (!details?.ok) throw new ImageError('The free picture library is not answering right now. Try again in a minute.')
  const image = (await details.json()) as OpenverseImage
  if (!/^https?:\/\//.test(image.url)) throw new ImageError('This picture cannot be copied. Choose another.')
  // The original, or else Openverse's own full-size copy.
  let file = await get(image.url, 30_000)
  if (!file?.ok) file = await get(`${OPENVERSE}/${id}/thumb/?full_size=true`, 30_000)
  if (!file?.ok) throw new ImageError('This picture could not be downloaded from its website. Choose another.')
  if (Number(file.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new ImageError('This picture is too large. Choose another.')
  return saveImage(new Uint8Array(await file.arrayBuffer()), creditOf(image))
}
