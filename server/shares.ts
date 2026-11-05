// Public share links for lessons (Creator and up). A link shows the lesson's chapters only: never
// its prompts or history. It stops working when revoked, or if the plan no longer includes sharing.

import { randomBytes } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import type { Share, ViewerLesson } from '../shared/protocol'
import type { Output, Project } from '../src/project'
import { SCENE_VERSION } from '../src/scene/schema'
import type { Account } from './accounts'
import type { Billing } from './billing/service'
import { effectiveBrand } from './brand'
import { now, type Db } from './db'
import { hasFeature } from './features'
import * as store from './store'


interface ShareRow {
  id: string
  workspace_id: string
  project_id: string
}

/** The project's link, creating one if it has none. */
export async function shareProject(db: Db, account: Account, projectId: string): Promise<Share> {
  if (!(await store.readProject(account.workspaceId, projectId))) throw new HTTPException(404, { message: 'Lesson not found' })
  const existing = await db.get<Share>(
    'SELECT id, project_id AS "projectId", created_at AS "createdAt" FROM shares WHERE workspace_id = ? AND project_id = ? AND revoked_at IS NULL',
    account.workspaceId,
    projectId,
  )
  if (existing) return { ...existing }
  const share: Share = { id: randomBytes(12).toString('base64url'), projectId, createdAt: now() }
  await db.run(
    'INSERT INTO shares (id, workspace_id, project_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    share.id, account.workspaceId, projectId, account.userId, share.createdAt,
  )
  return share
}

export async function shareFor(db: Db, workspaceId: string, projectId: string): Promise<Share | null> {
  const row = await db.get<Share>(
    'SELECT id, project_id AS "projectId", created_at AS "createdAt" FROM shares WHERE workspace_id = ? AND project_id = ? AND revoked_at IS NULL',
    workspaceId,
    projectId,
  )
  return row ? { ...row } : null
}

export async function revokeShare(db: Db, workspaceId: string, id: string): Promise<void> {
  await db.run('UPDATE shares SET revoked_at = ? WHERE id = ? AND workspace_id = ?', now(), id, workspaceId)
}

async function liveShare(db: Db, billing: Billing, id: string): Promise<ShareRow> {
  const row = await db.get<ShareRow>('SELECT id, workspace_id, project_id FROM shares WHERE id = ? AND revoked_at IS NULL', id)
  if (!row || !(await hasFeature(billing, row.workspace_id, 'shareLinks'))) throw new HTTPException(404, { message: 'This lesson is no longer shared.' })
  return row
}

/** What a viewer may see; soundtrack URLs are rewritten to the share's public asset route. */
export function toViewerLesson(project: Project, brand: ViewerLesson['brand'], assetUrl: (url: string) => string): ViewerLesson {
  return {
    title: project.name,
    brand,
    chapters: project.outputs
      .filter((output: Output) => output.scene.version === SCENE_VERSION)
      .map((output) => ({
        id: output.id,
        title: output.title,
        revision: output.revision,
        scene: output.scene,
        theatreState: output.theatreState,
        soundtrack: output.audio ? assetUrl(output.audio.url) : undefined,
      })),
  }
}

export async function sharedLesson(db: Db, billing: Billing, id: string): Promise<ViewerLesson> {
  const share = await liveShare(db, billing, id)
  const project = (await store.readProject(share.workspace_id, share.project_id)) as Project | null
  if (!project) throw new HTTPException(404, { message: 'This lesson no longer exists.' })
  const brand = await effectiveBrand(db, billing, share.workspace_id)
  return toViewerLesson(project, brand, (url) => `/api/shares/${id}/assets/${url.split('/').pop()}`)
}

/** A soundtrack of a shared lesson. */
export async function sharedAsset(db: Db, billing: Billing, id: string, name: string): Promise<string> {
  const share = await liveShare(db, billing, id)
  return store.assetFile(share.workspace_id, share.project_id, name)
}
