// Narration clips (data/speech/<hash>.wav) are shared by every lesson that says the same line in the
// same voice, so they are not deleted with a lesson. This sweep removes the ones nothing uses any
// more: lines that were edited, voices that were changed, lessons that were deleted. Creators'
// pictures (data/images, server/images.ts) are stored the same way and swept the same way.

import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Db } from './db'

const CLIP = /\/api\/speech\/([0-9a-f]{16}\.wav)/g
const IMAGE = /\/api\/images\/([0-9a-f]{16}\.(?:png|jpg|webp|gif))/g
const DAY = 24 * 60 * 60 * 1000

const dataDir = () => resolve(process.env.DATA_DIR ?? 'data')

async function filesIn(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => [])
}

/** Every file a lesson or an unclaimed chapter refers to, by name. */
async function filesInUse(db: Db, pattern: RegExp): Promise<Set<string>> {
  const used = new Set<string>()
  const collect = (text: string) => {
    for (const [, name] of text.matchAll(pattern)) used.add(name)
  }
  const workspaces = join(dataDir(), 'workspaces')
  for (const workspace of await filesIn(workspaces)) {
    const projects = join(workspaces, workspace, 'projects')
    for (const file of await filesIn(projects)) {
      if (file.endsWith('.json')) collect(await readFile(join(projects, file), 'utf8').catch(() => ''))
    }
  }
  // Chapters a job finished but the app has not picked up yet.
  for (const row of await db.all<{ output: string }>('SELECT output FROM job_outputs WHERE claimed_at IS NULL')) collect(row.output)
  return used
}

/**
 * Removes clips nothing refers to. Clips younger than `grace` are kept: a lesson being written now
 * records its lines before it is saved.
 */
export async function sweepClips(db: Db, grace = DAY): Promise<{ removed: number; bytes: number }> {
  return sweep(db, 'speech', CLIP, /^[0-9a-f]{16}\.wav$/, grace)
}

/** Removes pictures nothing shows. A week's grace: a picture is uploaded a while before its lesson is written. */
export async function sweepImages(db: Db, grace = 7 * DAY): Promise<{ removed: number; bytes: number }> {
  return sweep(db, 'images', IMAGE, /^[0-9a-f]{16}\.(png|jpg|webp|gif)$/, grace)
}

async function sweep(db: Db, folder: string, pattern: RegExp, fileName: RegExp, grace: number): Promise<{ removed: number; bytes: number }> {
  const used = await filesInUse(db, pattern)
  const dir = join(dataDir(), folder)
  let removed = 0
  let bytes = 0
  for (const name of await filesIn(dir)) {
    if (!fileName.test(name) || used.has(name)) continue
    const file = join(dir, name)
    const info = await stat(file).catch(() => null)
    if (!info || Date.now() - info.mtimeMs < grace) continue
    await rm(file, { force: true })
    removed++
    bytes += info.size
  }
  return { removed, bytes }
}

/** Sweeps now and then once a day. */
export function sweepClipsDaily(db: Db): void {
  const run = () => {
    sweepClips(db).then(
      ({ removed, bytes }) => removed > 0 && console.log(`Removed ${removed} unused narration clips (${(bytes / 1e6).toFixed(1)} MB)`),
      (error) => console.error('Could not remove unused narration clips:', error),
    )
    sweepImages(db).then(
      ({ removed, bytes }) => removed > 0 && console.log(`Removed ${removed} unused pictures (${(bytes / 1e6).toFixed(1)} MB)`),
      (error) => console.error('Could not remove unused pictures:', error),
    )
  }
  run()
  setInterval(run, DAY).unref()
}
