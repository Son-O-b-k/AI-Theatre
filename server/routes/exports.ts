import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Exports } from '../exports'
import { requireAccount, type AppEnv, type Deps } from './context'

export function exportRoutes({ db }: Deps, exports: Exports) {
  const app = new Hono<AppEnv>()
  app.use(requireAccount(db))

  app.post('/', async (c) => {
    const { projectId, kind, captions } = z
      .object({ projectId: z.string().regex(/^[\w-]{1,64}$/), kind: z.enum(['mp4', 'scorm']), captions: z.boolean().default(true) })
      .parse(await c.req.json())
    return c.json(await exports.start(c.var.account, projectId, kind, captions))
  })

  app.get('/:id', async (c) => c.json(await exports.status(c.var.account.workspaceId, c.req.param('id'))))

  app.get('/:id/file', async (c) => {
    const { path, name } = await exports.file(c.var.account.workspaceId, c.req.param('id'))
    c.header('content-type', name.endsWith('.mp4') ? 'video/mp4' : 'application/zip')
    c.header('content-length', String((await stat(path)).size))
    c.header('content-disposition', `attachment; filename="${name}"`)
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream)
  })

  return app
}
