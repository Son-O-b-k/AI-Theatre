// Projects are plain JSON files, kept per workspace; uploaded sounds live next to them.
//   data/workspaces/<workspace>/projects/<id>.json
//   data/workspaces/<workspace>/assets/<id>/<file>

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { ProjectSummary } from '../shared/protocol'

const ROOT = resolve(process.env.DATA_DIR ?? 'data')

const SAFE_ID = /^[\w-]{1,64}$/
const SAFE_FILE = /^[\w-][\w.-]{0,99}$/

function safe(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new HTTPException(400, { message: `Invalid name: ${value}` })
  return value
}

const workspaceDir = (workspace: string) => join(ROOT, 'workspaces', safe(workspace, SAFE_ID))
const projectsDir = (workspace: string) => join(workspaceDir(workspace), 'projects')
const projectFile = (workspace: string, id: string) => join(projectsDir(workspace), `${safe(id, SAFE_ID)}.json`)
const assetsDir = (workspace: string, projectId: string) => join(workspaceDir(workspace), 'assets', safe(projectId, SAFE_ID))
export const assetFile = (workspace: string, projectId: string, name: string) => join(assetsDir(workspace, projectId), safe(name, SAFE_FILE))

interface StoredProject {
  id: string
  name: string
  updatedAt: string
  outputs: unknown[]
}

export async function listProjects(workspace: string): Promise<ProjectSummary[]> {
  await mkdir(projectsDir(workspace), { recursive: true })
  const files = (await readdir(projectsDir(workspace))).filter((file) => file.endsWith('.json'))
  const projects = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(projectsDir(workspace), file), 'utf8')) as StoredProject),
  )
  return projects
    .map(({ id, name, updatedAt, outputs }) => ({ id, name, updatedAt, outputCount: outputs.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function readProject(workspace: string, id: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(projectFile(workspace, id), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeProject(workspace: string, id: string, project: unknown): Promise<void> {
  await mkdir(projectsDir(workspace), { recursive: true })
  const file = projectFile(workspace, id)
  // Write then rename so a crash never leaves a half-written project.
  await writeFile(`${file}.tmp`, JSON.stringify(project, null, 2))
  await rename(`${file}.tmp`, file)
}

export async function deleteProject(workspace: string, id: string): Promise<void> {
  await rm(projectFile(workspace, id), { force: true })
  await rm(assetsDir(workspace, id), { recursive: true, force: true })
}

export async function writeAsset(workspace: string, projectId: string, name: string, data: ArrayBuffer): Promise<void> {
  const file = assetFile(workspace, projectId, name)
  await mkdir(assetsDir(workspace, projectId), { recursive: true })
  await writeFile(file, new Uint8Array(data))
}

/** Lessons made before accounts existed (data/projects, data/assets) move into the first workspace. */
export async function adoptLegacyProjects(workspace: string): Promise<void> {
  for (const folder of ['projects', 'assets']) {
    const legacy = join(ROOT, folder)
    if (!existsSync(legacy)) continue
    await mkdir(workspaceDir(workspace), { recursive: true })
    await rename(legacy, join(workspaceDir(workspace), folder))
    console.log(`Moved ${legacy} into workspace ${workspace}`)
  }
}
