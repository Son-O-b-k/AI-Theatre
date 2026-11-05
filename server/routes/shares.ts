import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { requireFeature } from '../features'
import { revokeShare, shareFor, shareProject, sharedAsset, sharedLesson } from '../shares'
import { requireAccount, type AppEnv, type Deps } from './context'

const AUDIO_TYPES: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm' }

export function shareRoutes({ db, billing }: Deps) {
  const app = new Hono<AppEnv>()
  const signedIn = requireAccount(db)

  app.get('/', signedIn, async (c) => c.json(await shareFor(db, c.var.account.workspaceId, z.string().parse(c.req.query('projectId')))))

  app.post('/', signedIn, requireFeature(billing, 'shareLinks', 'Sharing lessons'), async (c) => {
    const { projectId } = z.object({ projectId: z.string().regex(/^[\w-]{1,64}$/) }).parse(await c.req.json())
    return c.json(await shareProject(db, c.var.account, projectId))
  })

  app.delete('/:id', signedIn, async (c) => {
    await revokeShare(db, c.var.account.workspaceId, c.req.param('id'))
    return c.body(null, 204)
  })

  // Public: the share page and embeds.
  app.get('/:id/lesson', async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await sharedLesson(db, billing, c.req.param('id')))
  })

  app.get('/:id/assets/:name', async (c) => {
    const data = await readFile(await sharedAsset(db, billing, c.req.param('id'), c.req.param('name'))).catch(() => null)
    if (!data) throw new HTTPException(404, { message: 'Not found' })
    c.header('content-type', AUDIO_TYPES[extname(c.req.param('name')).toLowerCase()] ?? 'application/octet-stream')
    return c.body(new Uint8Array(data))
  })

  return app
}
