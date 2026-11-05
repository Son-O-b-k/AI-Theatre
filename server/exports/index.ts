// Exports run in the background, one at a time per workspace: an MP4 video (Creator and up) or a
// SCORM package for learning systems (Teams). The app polls their progress and downloads the file.

import { mkdir, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { ExportStatus } from '../../shared/protocol'
import type { Output, Project } from '../../src/project'
import { SCENE_VERSION } from '../../src/scene/schema'
import type { Account } from '../accounts'
import type { Billing } from '../billing/service'
import { effectiveBrand, logoDataUrl } from '../brand'
import { newId, now, type Db } from '../db'
import { hasFeature, planFor } from '../features'
import * as store from '../store'
import { exportScorm } from './scorm'
import { exportVideo } from './video'

export type ExportKind = ExportStatus['kind']

const FEATURE = { mp4: 'videoExport', scorm: 'scorm' } as const
const EXTENSION = { mp4: 'mp4', scorm: 'zip' } as const
/** Finished exports are kept this many per lesson and kind; older files are removed. */
const KEEP = 2

const exportsDir = (workspaceId: string) => join(resolve(process.env.DATA_DIR ?? 'data'), 'workspaces', workspaceId, 'exports')

export class Exports {
  private readonly running = new Map<string, ExportStatus & { workspaceId: string }>()

  constructor(
    private readonly db: Db,
    private readonly billing: Billing,
  ) {}

  async recover(): Promise<void> {
    await this.db.run("UPDATE exports SET status = 'failed', error = 'The server restarted.', finished_at = ? WHERE status = 'running'", now())
  }

  async start(account: Account, projectId: string, kind: ExportKind, captions: boolean): Promise<ExportStatus> {
    const { workspaceId } = account
    if (!(await hasFeature(this.billing, workspaceId, FEATURE[kind]))) {
      const what = kind === 'mp4' ? 'Video export' : 'SCORM export'
      throw new HTTPException(402, { message: `${what} is part of the ${planFor(FEATURE[kind]).name} plan. Upgrade to use it.` })
    }
    if ([...this.running.values()].some((e) => e.workspaceId === workspaceId && e.status === 'running')) {
      throw new HTTPException(409, { message: 'An export is already running. Wait for it to finish.' })
    }
    const project = (await store.readProject(workspaceId, projectId)) as Project | null
    if (!project) throw new HTTPException(404, { message: 'Lesson not found' })
    const chapters = project.outputs.filter((o: Output) => o.scene.version === SCENE_VERSION)
    if (chapters.length === 0) throw new HTTPException(400, { message: 'This lesson has no chapters to export.' })

    const id = newId()
    const file = join(exportsDir(workspaceId), `${id}.${EXTENSION[kind]}`)
    await this.db.run(
      "INSERT INTO exports (id, workspace_id, project_id, kind, status, file, created_at) VALUES (?, ?, ?, ?, 'running', ?, ?)",
      id, workspaceId, projectId, kind, file, now(),
    )
    const status: ExportStatus & { workspaceId: string } = { id, kind, status: 'running', progress: 0, workspaceId }
    this.running.set(id, status)

    const work = async () => {
      const brand = await effectiveBrand(this.db, this.billing, workspaceId)
      const assetPath = (url: string) => store.assetFile(workspaceId, projectId, url.split('/').pop()!)
      const onProgress = (share: number) => (status.progress = share)
      await mkdir(exportsDir(workspaceId), { recursive: true })
      if (kind === 'mp4') {
        await exportVideo({
          chapters: chapters.map((o) => ({ scene: o.scene, theatreState: o.theatreState as never, soundtrack: o.audio ? assetPath(o.audio.url) : undefined })),
          brand: brand && { ...brand, logo: await logoDataUrl(workspaceId) },
          captions,
          output: file,
          onProgress,
        })
      } else {
        await exportScorm({ project: { ...project, outputs: chapters }, brand, workspaceId, assetPath, output: file, onProgress })
      }
    }

    work().then(
      async () => {
        Object.assign(status, { status: 'done', progress: 1 })
        await this.db.run("UPDATE exports SET status = 'done', finished_at = ? WHERE id = ?", now(), id)
        await this.prune(workspaceId, projectId, kind)
      },
      async (error) => {
        Object.assign(status, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
        await this.db.run("UPDATE exports SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", status.error ?? null, now(), id)
        await rm(file, { force: true })
      },
    ).catch((error) => console.error(`Export ${id} failed to finish:`, error))

    return this.public(status)
  }

  async status(workspaceId: string, id: string): Promise<ExportStatus> {
    const live = this.running.get(id)
    if (live?.workspaceId === workspaceId) return this.public(live)
    const row = await this.db.get<{ id: string; kind: ExportKind; status: ExportStatus['status']; error: string | null }>(
      'SELECT id, kind, status, error FROM exports WHERE id = ? AND workspace_id = ?',
      id,
      workspaceId,
    )
    if (!row) throw new HTTPException(404, { message: 'Export not found' })
    return { id: row.id, kind: row.kind, status: row.status, progress: row.status === 'done' ? 1 : 0, error: row.error ?? undefined }
  }

  /** The finished file and a name to save it as. */
  async file(workspaceId: string, id: string): Promise<{ path: string; name: string }> {
    const row = await this.db.get<{ file: string; kind: ExportKind; project_id: string; status: string }>(
      'SELECT file, kind, project_id, status FROM exports WHERE id = ? AND workspace_id = ?',
      id,
      workspaceId,
    )
    if (!row || row.status !== 'done' || !(await stat(row.file).catch(() => null))) throw new HTTPException(404, { message: 'Export not found' })
    const project = (await store.readProject(workspaceId, row.project_id)) as Project | null
    const slug = (project?.name ?? 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lesson'
    return { path: row.file, name: `${slug}${row.kind === 'scorm' ? '-scorm' : ''}.${EXTENSION[row.kind]}` }
  }

  private async prune(workspaceId: string, projectId: string, kind: ExportKind): Promise<void> {
    const old = await this.db.all<{ id: string; file: string }>(
      "SELECT id, file FROM exports WHERE workspace_id = ? AND project_id = ? AND kind = ? AND status = 'done' ORDER BY created_at DESC",
      workspaceId,
      projectId,
      kind,
    )
    for (const row of old.slice(KEEP)) {
      await rm(row.file, { force: true })
      await this.db.run("UPDATE exports SET status = 'failed', error = 'Removed: a newer export replaced it.' WHERE id = ?", row.id)
    }
  }

  private public({ id, kind, status, progress, error }: ExportStatus): ExportStatus {
    return { id, kind, status, progress, error }
  }
}
