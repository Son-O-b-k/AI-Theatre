import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import * as store from '../store'
import { requireAccount, type AppEnv, type Deps } from './context'

const ProjectSchema = z
  .object({ id: z.string(), name: z.string(), updatedAt: z.string(), outputs: z.array(z.unknown()) })
  .passthrough()

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
}

/** Lessons and their uploaded sounds, within the signed-in workspace. */
export function projectRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()
  app.use(requireAccount(db))
  const workspace = (c: { var: AppEnv['Variables'] }) => c.var.account.workspaceId

  app.get('/', async (c) => c.json(await store.listProjects(workspace(c))))

  app.get('/:id', async (c) => {
    const project = await store.readProject(workspace(c), c.req.param('id'))
    if (!project) throw new HTTPException(404, { message: 'Project not found' })
    return c.json(project)
  })

  app.put('/:id', async (c) => {
    const project = ProjectSchema.parse(await c.req.json())
    if (project.id !== c.req.param('id')) throw new HTTPException(400, { message: 'Project id mismatch' })
    await store.writeProject(workspace(c), project.id, project)
    return c.body(null, 204)
  })

  app.delete('/:id', async (c) => {
    await store.deleteProject(workspace(c), c.req.param('id'))
    return c.body(null, 204)
  })

  app.put('/:id/assets/:name', async (c) => {
    const { id, name } = c.req.param()
    await store.writeAsset(workspace(c), id, name, await c.req.arrayBuffer())
    return c.json({ url: `/api/projects/${id}/assets/${name}` })
  })

  app.get('/:id/assets/:name', async (c) => {
    const { id, name } = c.req.param()
    const data = await readFile(store.assetFile(workspace(c), id, name)).catch(() => null)
    if (!data) throw new HTTPException(404, { message: 'Asset not found' })
    c.header('content-type', AUDIO_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream')
    return c.body(new Uint8Array(data))
  })

  return app
}
