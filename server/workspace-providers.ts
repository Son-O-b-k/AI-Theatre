// A workspace's own AI providers: its own keys or its own servers, on any plan. Keys are encrypted at
// rest and never sent back to the browser. Lessons made with them use the plan's own-key allowance
// (shared/plans.ts), not its lessons.

import { isIP } from 'node:net'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { WorkspaceProvider } from '../shared/protocol'
import type { ProviderConfig } from './config'
import { newId, now, type Db } from './db'
import { createProvider, type Provider } from './providers'
import { decrypt, encrypt } from './secrets'

/** Workspace providers have ids "ws-<id>", so they never clash with the server's own. */
export const WORKSPACE_PREFIX = 'ws-'
export const isWorkspaceProvider = (id: string) => id.startsWith(WORKSPACE_PREFIX)

/**
 * The server calls the address a workspace gives, so in production it must not point into our own
 * network. ALLOW_PRIVATE_AI_URLS=true lifts this (a self-hosted install whose Ollama is on the LAN).
 */
export function checkProviderUrl(baseUrl: string | undefined): void {
  if (!baseUrl || process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_AI_URLS === 'true') return
  const { protocol, hostname } = new URL(baseUrl)
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local') ||
    (isIP(host) === 4 && /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)) ||
    (isIP(host) === 6 && /^(::1?$|f[cd]|fe[89ab]|::ffff:)/.test(host))
  if (privateHost || !/^https?:$/.test(protocol)) {
    throw new HTTPException(400, { message: 'That address is not reachable from AI Theatre. Use a public address (for Ollama on your computer, a tunnel such as ngrok).' })
  }
}

export const WorkspaceProviderSchema = z.object({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(['openai', 'anthropic', 'ollama']),
  baseUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  apiKey: z.string().trim().max(500).optional(),
  /** Empty offers every model the provider lists. */
  models: z.array(z.string().trim().min(1)).max(50).default([]),
})

export type NewProvider = z.infer<typeof WorkspaceProviderSchema>

interface Row {
  id: string
  label: string
  kind: ProviderConfig['kind']
  base_url: string | null
  api_key: string | null
  models: string
}

const toInfo = (row: Row): WorkspaceProvider => ({
  id: `${WORKSPACE_PREFIX}${row.id}`,
  label: row.label,
  kind: row.kind,
  baseUrl: row.base_url ?? undefined,
  models: JSON.parse(row.models),
  hasKey: Boolean(row.api_key),
})

/** A provider from the form, before it is saved: used to check the key and list its models. */
function draftProvider(input: NewProvider): Provider {
  checkProviderUrl(input.baseUrl)
  return createProvider({ id: 'draft', label: input.label, kind: input.kind, baseUrl: input.baseUrl, apiKey: input.apiKey || undefined })
}

/** Asks the provider for its models with the key given: proves the key works before it is saved. */
export async function checkWorkspaceProvider(input: NewProvider): Promise<string[]> {
  try {
    const models = await draftProvider(input).listModels()
    if (models.length === 0) throw new Error('it lists no models')
    return models
  } catch (error) {
    if (error instanceof HTTPException) throw error
    const reason = error instanceof Error ? error.message : String(error)
    if (/^40[13]\b/.test(reason)) throw new HTTPException(400, { message: 'The provider did not accept that key. Check it and try again.' })
    // Only the first line: providers answer with whole JSON documents.
    throw new HTTPException(400, { message: `Could not connect: ${reason.split('\n')[0].slice(0, 160)}` })
  }
}

export async function listWorkspaceProviders(db: Db, workspaceId: string): Promise<WorkspaceProvider[]> {
  return (await db.all<Row>('SELECT * FROM workspace_providers WHERE workspace_id = ? ORDER BY created_at', workspaceId)).map(toInfo)
}

/** Saves the provider once it answers; a provider that cannot list its models must name them. */
export async function addWorkspaceProvider(db: Db, workspaceId: string, input: NewProvider, check = checkWorkspaceProvider): Promise<WorkspaceProvider> {
  checkProviderUrl(input.baseUrl)
  if (input.models.length === 0) await check(input)
  const id = newId()
  await db.run(
    'INSERT INTO workspace_providers (id, workspace_id, label, kind, base_url, api_key, models, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, workspaceId, input.label, input.kind, input.baseUrl ?? null, input.apiKey ? encrypt(input.apiKey) : null, JSON.stringify(input.models), now(),
  )
  return (await listWorkspaceProviders(db, workspaceId)).find((p) => p.id === `${WORKSPACE_PREFIX}${id}`)!
}

export async function removeWorkspaceProvider(db: Db, workspaceId: string, id: string): Promise<void> {
  await db.run('DELETE FROM workspace_providers WHERE id = ? AND workspace_id = ?', id.slice(WORKSPACE_PREFIX.length), workspaceId)
}

function fromRow(row: Row): Provider {
  const models: string[] = JSON.parse(row.models)
  return createProvider({
    id: `${WORKSPACE_PREFIX}${row.id}`,
    label: row.label,
    kind: row.kind,
    baseUrl: row.base_url ?? undefined,
    apiKey: row.api_key ? decrypt(row.api_key) : undefined,
    // No list saved: ask the provider each time, so new models appear without editing anything.
    models: models.length > 0 ? models : undefined,
  })
}

/** Every provider of the workspace, ready to list models. */
export async function workspaceProviders(db: Db, workspaceId: string): Promise<Provider[]> {
  return (await db.all<Row>('SELECT * FROM workspace_providers WHERE workspace_id = ? ORDER BY created_at', workspaceId)).map(fromRow)
}

/** A ready provider for a job, with its key decrypted. */
export async function workspaceProvider(db: Db, workspaceId: string, id: string): Promise<Provider> {
  const row = await db.get<Row>('SELECT * FROM workspace_providers WHERE id = ? AND workspace_id = ?', id.slice(WORKSPACE_PREFIX.length), workspaceId)
  if (!row) throw new HTTPException(404, { message: 'That AI provider is no longer set up.' })
  checkProviderUrl(row.base_url ?? undefined)
  return fromRow(row)
}
