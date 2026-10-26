// Projects are plain JSON files; uploaded sounds live next to them.
//   data/projects/<id>.json
//   data/assets/<id>/<file>

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { HTTPException } from 'hono/http-exception'
import type { ProjectSummary } from '../shared/protocol'

const ROOT = resolve(process.env.DATA_DIR ?? 'data')
const PROJECTS = join(ROOT, 'projects')
const ASSETS = join(ROOT, 'assets')

const SAFE_ID = /^[\w-]{1,64}$/
const SAFE_FILE = /^[\w-][\w.-]{0,99}$/

function safe(value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new HTTPException(400, { message: `Invalid name: ${value}` })
  return value
}

const projectFile = (id: string) => join(PROJECTS, `${safe(id, SAFE_ID)}.json`)
export const assetFile = (projectId: string, name: string) =>
  join(ASSETS, safe(projectId, SAFE_ID), safe(name, SAFE_FILE))

interface StoredProject {
  id: string
  name: string
  updatedAt: string
  outputs: unknown[]
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(PROJECTS, { recursive: true })
  const files = (await readdir(PROJECTS)).filter((file) => file.endsWith('.json'))
  const projects = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(join(PROJECTS, file), 'utf8')) as StoredProject),
  )
  return projects
    .map(({ id, name, updatedAt, outputs }) => ({ id, name, updatedAt, outputCount: outputs.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function readProject(id: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(projectFile(id), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeProject(id: string, project: unknown): Promise<void> {
  await mkdir(PROJECTS, { recursive: true })
  const file = projectFile(id)
  // Write then rename so a crash never leaves a half-written project.
  await writeFile(`${file}.tmp`, JSON.stringify(project, null, 2))
  await rename(`${file}.tmp`, file)
}

export async function deleteProject(id: string): Promise<void> {
  await rm(projectFile(id), { force: true })
  await rm(join(ASSETS, safe(id, SAFE_ID)), { recursive: true, force: true })
}

export async function writeAsset(projectId: string, name: string, data: ArrayBuffer): Promise<void> {
  const file = assetFile(projectId, name)
  await mkdir(join(ASSETS, projectId), { recursive: true })
  await writeFile(file, new Uint8Array(data))
}
