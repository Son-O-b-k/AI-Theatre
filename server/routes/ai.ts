import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { defaultModelFromEnv } from '../config'
import { describeDefault, describeProvider } from '../providers'
import { hasFeature, planFor, requireFeature } from '../features'
import {
  addWorkspaceProvider,
  checkWorkspaceProvider,
  listWorkspaceProviders,
  removeWorkspaceProvider,
  workspaceProviders,
  WorkspaceProviderSchema,
} from '../workspace-providers'
import * as speech from '../speech'
import { requireAccount, requireOwner, type AppEnv, type Deps } from './context'

const SpeechRequestSchema = z.object({ text: z.string().min(1).max(2000), voice: z.string() })

/** The configured AI providers, and the voice. Lessons are written by jobs (./jobs.ts), which meter the model. */
export function aiRoutes({ db, billing, providers }: Deps) {
  const app = new Hono<AppEnv>()
  const signedIn = requireAccount(db)

  // "AI Theatre" (the server's default, without saying which model runs it), then the workspace's own
  // keys, listed live so a key's new models appear without editing anything. The server's other
  // providers are not offered: which model the plan uses is ours to choose.
  app.get('/providers', signedIn, async (c) => {
    const { workspaceId } = c.var.account
    const ownAllowed = await hasFeature(billing, workspaceId, 'ownProviders')
    const [fallback, own] = await Promise.all([
      describeDefault(providers, defaultModelFromEnv()),
      ownAllowed ? workspaceProviders(db, workspaceId).then((list) => Promise.all(list.map((p) => describeProvider(p, 'own')))) : [],
    ])
    return c.json([fallback, ...own])
  })

  // Tries a key before it is saved, and returns the models it can use.
  app.post('/workspace-providers/check', signedIn, requireOwner, requireFeature(billing, 'ownProviders', 'Your own AI provider'), async (c) =>
    c.json({ models: await checkWorkspaceProvider(WorkspaceProviderSchema.parse(await c.req.json())) }),
  )

  app.get('/workspace-providers', signedIn, async (c) => c.json(await listWorkspaceProviders(db, c.var.account.workspaceId)))

  app.post('/workspace-providers', signedIn, requireOwner, requireFeature(billing, 'ownProviders', 'Your own AI provider'), async (c) =>
    c.json(await addWorkspaceProvider(db, c.var.account.workspaceId, WorkspaceProviderSchema.parse(await c.req.json()))),
  )

  app.delete('/workspace-providers/:id', signedIn, requireOwner, async (c) => {
    await removeWorkspaceProvider(db, c.var.account.workspaceId, c.req.param('id'))
    return c.body(null, 204)
  })

  app.get('/speech/voices', (c) => c.json(speech.voices()))

  app.post('/speech', signedIn, async (c) => {
    const { text, voice } = SpeechRequestSchema.parse(await c.req.json())
    if (speech.isPremium(voice) && !(await hasFeature(billing, c.var.account.workspaceId, 'premiumVoices'))) {
      throw new HTTPException(402, { message: `Premium voices are part of the ${planFor('premiumVoices').name} plan.` })
    }
    return c.json(await speech.speak(text, voice))
  })

  // Clips are named by the hash of their voice and text: unguessable, and they never change.
  app.get('/speech/:name', async (c) => {
    const data = await readFile(speech.clipFile(c.req.param('name'))).catch(() => null)
    if (!data) throw new HTTPException(404, { message: 'Clip not found' })
    c.header('cache-control', 'public, max-age=31536000, immutable')
    c.header('content-type', 'audio/wav')
    return c.body(new Uint8Array(data))
  })

  return app
}
