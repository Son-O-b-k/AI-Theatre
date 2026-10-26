import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { stream } from 'hono/streaming'
import { z, ZodError } from 'zod'
import type { StreamEvent } from '../shared/protocol'
import { loadProviderConfigs } from './config'
import { createProvider, describeProvider } from './providers'
import * as speech from './speech'
import * as store from './store'

const PORT = Number(process.env.PORT ?? 8787)

const providers = new Map((await loadProviderConfigs()).map((config) => [config.id, createProvider(config)]))

const ChatRequestSchema = z.object({
  provider: z.string(),
  model: z.string().min(1),
  system: z.string(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
})

const ProjectSchema = z
  .object({ id: z.string(), name: z.string(), updatedAt: z.string(), outputs: z.array(z.unknown()) })
  .passthrough()

const SpeechRequestSchema = z.object({ text: z.string().min(1).max(2000), voice: z.string() })

const AUDIO_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
}

const app = new Hono()

app.get('/api/providers', async (c) => c.json(await Promise.all([...providers.values()].map(describeProvider))))

app.post('/api/chat', async (c) => {
  const { provider: providerId, ...request } = ChatRequestSchema.parse(await c.req.json())
  const provider = providers.get(providerId)
  if (!provider) throw new HTTPException(404, { message: `Unknown provider: ${providerId}` })

  c.header('content-type', 'application/x-ndjson')
  return stream(c, async (out) => {
    const abort = new AbortController()
    out.onAbort(() => abort.abort())
    const send = (event: StreamEvent) => out.write(JSON.stringify(event) + '\n')

    try {
      for await (const text of provider.stream(request, abort.signal)) await send({ type: 'text', text })
      await send({ type: 'done' })
    } catch (error) {
      if (!abort.signal.aborted) await send({ type: 'error', message: errorMessage(error) })
    }
  })
})

app.get('/api/projects', async (c) => c.json(await store.listProjects()))

app.get('/api/projects/:id', async (c) => {
  const project = await store.readProject(c.req.param('id'))
  if (!project) throw new HTTPException(404, { message: 'Project not found' })
  return c.json(project)
})

app.put('/api/projects/:id', async (c) => {
  const project = ProjectSchema.parse(await c.req.json())
  if (project.id !== c.req.param('id')) throw new HTTPException(400, { message: 'Project id mismatch' })
  await store.writeProject(project.id, project)
  return c.body(null, 204)
})

app.delete('/api/projects/:id', async (c) => {
  await store.deleteProject(c.req.param('id'))
  return c.body(null, 204)
})

app.put('/api/projects/:id/assets/:name', async (c) => {
  const { id, name } = c.req.param()
  await store.writeAsset(id, name, await c.req.arrayBuffer())
  return c.json({ url: `/api/projects/${id}/assets/${name}` })
})

app.get('/api/projects/:id/assets/:name', async (c) => {
  const { id, name } = c.req.param()
  const data = await readFile(store.assetFile(id, name)).catch(() => null)
  if (!data) throw new HTTPException(404, { message: 'Asset not found' })
  c.header('content-type', AUDIO_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream')
  return c.body(new Uint8Array(data))
})

app.get('/api/speech/voices', (c) => c.json(speech.VOICES))

app.post('/api/speech', async (c) => {
  const { text, voice } = SpeechRequestSchema.parse(await c.req.json())
  return c.json(await speech.speak(text, voice))
})

app.get('/api/speech/:name', async (c) => {
  const data = await readFile(speech.clipFile(c.req.param('name'))).catch(() => null)
  if (!data) throw new HTTPException(404, { message: 'Clip not found' })
  // A clip's name is the hash of its voice and text, so it never changes.
  c.header('cache-control', 'public, max-age=31536000, immutable')
  c.header('content-type', 'audio/wav')
  return c.body(new Uint8Array(data))
})

if (process.env.NODE_ENV === 'production') app.use('/*', serveStatic({ root: './dist' }))

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  if (error instanceof ZodError) return c.json({ error: error.issues }, 400)
  console.error(error)
  return c.json({ error: errorMessage(error) }, 500)
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Hono's faster global Response breaks the voice model's downloads (server/speech.ts), so keep Node's own.
serve({ fetch: app.fetch, port: PORT, overrideGlobalObjects: false }, () => console.log(`API listening on http://localhost:${PORT}`))
