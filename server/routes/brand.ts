import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { BrandColorsSchema, clearBrand, getBrand, LOGO_TYPES, MAX_LOGO_BYTES, readLogo, setBrandColors, setLogo } from '../brand'
import { requireFeature } from '../features'
import { requireAccount, requireOwner, type AppEnv, type Deps } from './context'

export function brandRoutes({ db, billing }: Deps) {
  const app = new Hono<AppEnv>()
  const manage = [requireAccount(db), requireOwner, requireFeature(billing, 'branding', 'Your own brand')] as const

  // Public: share pages and embeds show the logo. Workspace ids are random and unguessable.
  app.get('/:workspaceId/logo', async (c) => {
    const logo = await readLogo(c.req.param('workspaceId'))
    if (!logo) throw new HTTPException(404, { message: 'No logo' })
    c.header('content-type', logo.type)
    c.header('cache-control', 'public, max-age=31536000, immutable')
    // An uploaded SVG must never run scripts, even if opened directly.
    c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    c.header('x-content-type-options', 'nosniff')
    return c.body(new Uint8Array(logo.data))
  })

  app.get('/', requireAccount(db), async (c) => c.json(await getBrand(db, c.var.account.workspaceId)))

  app.put('/', ...manage, async (c) => c.json(await setBrandColors(db, c.var.account.workspaceId, BrandColorsSchema.parse(await c.req.json()))))

  app.delete('/', ...manage, async (c) => {
    await clearBrand(db, c.var.account.workspaceId)
    return c.body(null, 204)
  })

  app.put('/logo', ...manage, async (c) => {
    const type = c.req.header('content-type') ?? ''
    if (!(type in LOGO_TYPES)) throw new HTTPException(400, { message: 'Use a PNG, JPEG, WebP or SVG logo.' })
    const data = await c.req.arrayBuffer()
    if (data.byteLength > MAX_LOGO_BYTES) throw new HTTPException(400, { message: 'The logo must be under 512 KB.' })
    return c.json(await setLogo(db, c.var.account.workspaceId, type, data))
  })

  return app
}
