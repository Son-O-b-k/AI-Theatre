// A workspace's own AI providers (Teams): its own keys or its own servers. Keys are encrypted at
// rest and never sent back to the browser. Lessons made with them do not use the plan's allowance.

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

export const WorkspaceProviderSchema = z.object({
  label: z.string().trim().min(1).max(60),
  kind: z.enum(['openai', 'anthropic', 'ollama']),
  baseUrl: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  apiKey: z.string().max(500).optional(),
  models: z.array(z.string().trim().min(1)).min(1, 'List at least one model.').max(30),
})

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

export async function listWorkspaceProviders(db: Db, workspaceId: string): Promise<WorkspaceProvider[]> {
  return (await db.all<Row>('SELECT * FROM workspace_providers WHERE workspace_id = ? ORDER BY created_at', workspaceId)).map(toInfo)
}

export async function addWorkspaceProvider(db: Db, workspaceId: string, input: z.infer<typeof WorkspaceProviderSchema>): Promise<WorkspaceProvider> {
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

/** A ready provider for a job, with its key decrypted. */
export async function workspaceProvider(db: Db, workspaceId: string, id: string): Promise<Provider> {
  const row = await db.get<Row>('SELECT * FROM workspace_providers WHERE id = ? AND workspace_id = ?', id.slice(WORKSPACE_PREFIX.length), workspaceId)
  if (!row) throw new HTTPException(404, { message: 'That AI provider is no longer set up.' })
  return createProvider({
    id,
    label: row.label,
    kind: row.kind,
    baseUrl: row.base_url ?? undefined,
    apiKey: row.api_key ? decrypt(row.api_key) : undefined,
    models: JSON.parse(row.models),
  })
}
