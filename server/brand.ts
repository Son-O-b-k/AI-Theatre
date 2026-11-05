// A workspace's brand: colours stored with the workspace, the logo as a file next to its lessons.
// Only plans with the `branding` feature have their brand applied (effectiveBrand).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Brand } from '../shared/protocol'
import type { Billing } from './billing/service'
import type { Db } from './db'
import { hasFeature } from './features'

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours are written as #rrggbb.').transform((v) => v.toLowerCase())

export const BrandColorsSchema = z.object({ background: hex, primary: hex, highlight: hex })

export const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }
export const MAX_LOGO_BYTES = 512 * 1024

const logoDir = (workspaceId: string) => join(resolve(process.env.DATA_DIR ?? 'data'), 'workspaces', workspaceId, 'brand')

export async function getBrand(db: Db, workspaceId: string): Promise<Brand | null> {
  const row = await db.get<{ brand: string | null }>('SELECT brand FROM workspaces WHERE id = ?', workspaceId)
  return row?.brand ? (JSON.parse(row.brand) as Brand) : null
}

/** The brand to show, or null when there is none or the plan does not include branding. */
export async function effectiveBrand(db: Db, billing: Billing, workspaceId: string): Promise<Brand | null> {
  return (await hasFeature(billing, workspaceId, 'branding')) ? getBrand(db, workspaceId) : null
}

export async function setBrandColors(db: Db, workspaceId: string, colors: z.infer<typeof BrandColorsSchema>): Promise<Brand> {
  const brand: Brand = { ...(await getBrand(db, workspaceId)), ...colors }
  await db.run('UPDATE workspaces SET brand = ? WHERE id = ?', JSON.stringify(brand), workspaceId)
  return brand
}

export async function clearBrand(db: Db, workspaceId: string): Promise<void> {
  await db.run('UPDATE workspaces SET brand = NULL WHERE id = ?', workspaceId)
  await rm(logoDir(workspaceId), { recursive: true, force: true })
}

export async function setLogo(db: Db, workspaceId: string, type: string, data: ArrayBuffer): Promise<Brand> {
  const current = await getBrand(db, workspaceId)
  if (!current) throw new HTTPException(400, { message: 'Choose the brand colours first.' })
  await rm(logoDir(workspaceId), { recursive: true, force: true })
  await mkdir(logoDir(workspaceId), { recursive: true })
  await writeFile(join(logoDir(workspaceId), `logo.${LOGO_TYPES[type]}`), new Uint8Array(data))
  // The version in the URL makes browsers fetch a replaced logo instead of a cached one.
  const brand = { ...current, logo: `/api/brand/${workspaceId}/logo?v=${Date.now()}` }
  await db.run('UPDATE workspaces SET brand = ? WHERE id = ?', JSON.stringify(brand), workspaceId)
  return brand
}

export async function readLogo(workspaceId: string): Promise<{ data: Buffer; type: string } | null> {
  for (const [type, ext] of Object.entries(LOGO_TYPES)) {
    const data = await readFile(join(logoDir(workspaceId), `logo.${ext}`)).catch(() => null)
    if (data) return { data, type }
  }
  return null
}

/** The logo as a data URL, for renderers that cannot fetch (video export). */
export async function logoDataUrl(workspaceId: string): Promise<string | undefined> {
  const logo = await readLogo(workspaceId)
  return logo ? `data:${logo.type};base64,${logo.data.toString('base64')}` : undefined
}
