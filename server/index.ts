import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { AccountError } from './accounts'
import { JobError } from './lessons/jobs'
import { loadBillingProvider } from './billing/providers'
import { DevBillingProvider } from './billing/providers/dev'
import { Billing, BillingError } from './billing/service'
import { loadProviderConfigs } from './config'
import { openDb } from './db'
import { createMailer } from './email'
import { Exports } from './exports'
import { Jobs } from './lessons/jobs'
import { createProvider } from './providers'
import { aiRoutes } from './routes/ai'
import { authRoutes } from './routes/auth'
import { billingRoutes } from './routes/billing'
import { exportRoutes } from './routes/exports'
import { brandRoutes } from './routes/brand'
import { jobRoutes } from './routes/jobs'
import type { Deps } from './routes/context'
import { projectRoutes } from './routes/projects'
import { shareRoutes } from './routes/shares'
import { teamRoutes } from './routes/team'

// Settings (database, payment and AI keys) can live in .env; see .env.example.
if (existsSync('.env')) process.loadEnvFile('.env')

const PORT = Number(process.env.PORT ?? 8787)

const db = await openDb()
const billing = new Billing(db, await loadBillingProvider())
// The dev provider "sends" its webhooks straight to the billing core.
if (billing.provider instanceof DevBillingProvider) billing.provider.deliver = (body, headers) => billing.handleWebhook(body, headers)
const providers = new Map((await loadProviderConfigs()).map((config) => [config.id, createProvider(config)]))
const deps: Deps = { db, billing, providers, mailer: createMailer() }
const jobs = new Jobs(db, billing, providers)
await jobs.recover()
const exports = new Exports(db, billing)
await exports.recover()

const app = new Hono()
app.route('/api/auth', authRoutes(deps))
app.route('/api/billing', billingRoutes(deps))
app.route('/api/team', teamRoutes(deps))
app.route('/api/brand', brandRoutes(deps))
app.route('/api/shares', shareRoutes(deps))
app.route('/api/jobs', jobRoutes(deps, jobs))
app.route('/api/exports', exportRoutes(deps, exports))
app.route('/api/projects', projectRoutes(deps))
app.route('/api', aiRoutes(deps))

if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }))
  // The page decides between the landing page and the app from the path.
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
  if (error instanceof BillingError) return c.json({ error: error.message }, error.status)
  if (error instanceof AccountError) return c.json({ error: error.message }, 400)
  if (error instanceof JobError) return c.json({ error: error.message }, error.status)
  if (error instanceof ZodError) return c.json({ error: error.issues.map((issue) => issue.message).join(' ') }, 400)
  console.error(error)
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 500)
})

// Hono's faster global Response breaks the voice model's downloads (server/speech.ts), so keep Node's own.
serve({ fetch: app.fetch, port: PORT, overrideGlobalObjects: false }, () => console.log(`API listening on http://localhost:${PORT}`))
