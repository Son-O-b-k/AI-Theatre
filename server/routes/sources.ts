import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { MAX_SOURCE_BYTES, SourceError, sourceText } from '../sources'
import { requireAccount, type AppEnv, type Deps } from './context'

/** Reads the text out of a document to teach a lesson from. The file itself is not kept. */
export function sourceRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()

  app.post(
    '/',
    requireAccount(db),
    bodyLimit({
      maxSize: MAX_SOURCE_BYTES,
      onError: () => {
        throw new HTTPException(413, { message: 'The file must be under 10 MB.' })
      },
    }),
    async (c) => {
      const name = z.string().min(1).max(255).parse(c.req.query('name'))
      try {
        return c.json(await sourceText(name, new Uint8Array(await c.req.arrayBuffer())))
      } catch (error) {
        if (error instanceof SourceError) throw new HTTPException(400, { message: error.message })
        throw error
      }
    },
  )

  return app
}
