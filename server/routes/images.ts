import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { ImageError, imageFile, imageType, importImage, MAX_IMAGE_BYTES, saveImage, searchImages } from '../images'
import { requireAccount, type AppEnv, type Deps } from './context'

const NAME = /^[0-9a-f]{16}\.(png|jpg|webp|gif)$/

/** Creators' pictures: uploading, finding free ones, and serving them. */
export function imageRoutes({ db }: Deps) {
  const app = new Hono<AppEnv>()

  const readable = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work()
    } catch (error) {
      if (error instanceof ImageError) throw new HTTPException(400, { message: error.message })
      throw error
    }
  }

  app.post(
    '/',
    requireAccount(db),
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES,
      onError: () => {
        throw new HTTPException(413, { message: 'The picture must be under 15 MB.' })
      },
    }),
    async (c) => c.json(await readable(async () => saveImage(new Uint8Array(await c.req.arrayBuffer())))),
  )

  app.get('/search', requireAccount(db), async (c) => {
    const query = z.string().trim().min(1).max(100).parse(c.req.query('q'))
    return c.json(await readable(() => searchImages(query)))
  })

  app.post('/import', requireAccount(db), async (c) => {
    const { id } = z.object({ id: z.string() }).parse(await c.req.json())
    return c.json(await readable(() => importImage(id)))
  })

  // Public, like narration clips: share pages and embeds show the pictures. Names are content hashes.
  app.get('/:name', async (c) => {
    const name = c.req.param('name')
    if (!NAME.test(name)) throw new HTTPException(404, { message: 'No such picture' })
    const data = await readFile(imageFile(name)).catch(() => null)
    if (!data) throw new HTTPException(404, { message: 'No such picture' })
    c.header('content-type', imageType(name))
    c.header('cache-control', 'public, max-age=31536000, immutable')
    c.header('x-content-type-options', 'nosniff')
    return c.body(new Uint8Array(data))
  })

  return app
}
