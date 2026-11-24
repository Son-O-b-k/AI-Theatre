import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { MAX_LESSON_IMAGES, MAX_SOURCE_CHARS, type JobEvent } from '../../shared/protocol'
import { FORMATS, IMAGE_URL } from '../../src/scene/schema'

const LessonImageSchema = z.object({
  id: z.string().regex(/^[\w-]{1,24}$/),
  url: z.string().regex(IMAGE_URL),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  about: z.string().trim().max(300).default(''),
  look: z.enum(['photo', 'sketch']).default('photo'),
  spots: z
    .array(z.object({ name: z.string().trim().min(1).max(40), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .max(12)
    .default([]),
  credit: z.string().trim().max(200).optional(),
})
import type { Jobs } from '../lessons/jobs'
import { requireAccount, type AppEnv, type Deps } from './context'

export const JobRequestSchema = z.object({
  mode: z.enum(['teach', 'scene', 'refine']),
  prompt: z.string().trim().min(1).max(4000),
  projectId: z.string().regex(/^[\w-]{1,64}$/),
  provider: z.string(),
  model: z.string().min(1),
  voice: z.string(),
  output: z.unknown().optional(),
  language: z.string().optional(),
  format: z.enum(FORMATS).optional(),
  source: z.string().trim().max(MAX_SOURCE_CHARS + 1000).optional(),
  images: z.array(LessonImageSchema).max(MAX_LESSON_IMAGES).optional(),
})

/** Lesson generation on the server, and the chapters it delivers. */
export function jobRoutes({ db }: Deps, jobs: Jobs) {
  const app = new Hono<AppEnv>()
  app.use(requireAccount(db))

  app.post('/', async (c) => {
    const request = JobRequestSchema.parse(await c.req.json())
    return c.json({ id: await jobs.start(c.var.account, request) })
  })

  app.get('/active', (c) => c.json(jobs.active(c.var.account.workspaceId)))

  app.get('/deliveries', async (c) => {
    const projectId = z.string().parse(c.req.query('projectId'))
    return c.json(await jobs.unclaimed(c.var.account.workspaceId, projectId))
  })

  app.post('/deliveries/claim', async (c) => {
    const { ids } = z.object({ ids: z.array(z.string()).max(100) }).parse(await c.req.json())
    await jobs.claim(c.var.account.workspaceId, ids)
    return c.body(null, 204)
  })

  app.post('/:id/cancel', (c) => {
    jobs.cancel(c.req.param('id'), c.var.account.workspaceId)
    return c.body(null, 204)
  })

  // What already happened, then each new event; ends with the job.
  app.get('/:id/events', (c) => {
    const { workspaceId } = c.var.account
    const id = c.req.param('id')
    return streamSSE(c, async (out) => {
      let finished: () => void = () => {}
      const done = new Promise<void>((resolve) => (finished = resolve))
      const queue: JobEvent[] = []
      let writing = Promise.resolve()
      const send = (event: JobEvent) => {
        queue.push(event)
        writing = writing.then(async () => {
          const next = queue.shift()!
          await out.writeSSE({ data: JSON.stringify(next) })
          if (next.type === 'end') finished()
        })
      }
      // An unknown job ends at once, so the app stops waiting rather than reconnecting forever.
      const unsubscribe = await jobs.subscribe(id, workspaceId, send).catch((error: unknown) => {
        send({ type: 'end', status: 'failed', error: error instanceof Error ? error.message : String(error) })
        return () => {}
      })
      out.onAbort(finished)
      await done
      await writing
      unsubscribe()
    })
  })

  return app
}
