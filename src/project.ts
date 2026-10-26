import { compile } from './scene/compile'
import { finalizeScene } from './scene/scene'
import type { Scene } from './scene/schema'
import { toTheatreState, type TheatreState } from './scene/theatre'

export interface Turn {
  prompt: string
  provider: string
  model: string
  at: string
}

export interface Output {
  id: string
  title: string
  /** Bumped whenever the AI rewrites the scene; part of the Theatre project id. */
  revision: number
  scene: Scene
  theatreState: TheatreState
  audio?: { name: string; url: string }
  history: Turn[]
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  outputs: Output[]
}

export const shortId = () => crypto.randomUUID().slice(0, 8)

export function newProject(name: string): Project {
  const now = new Date().toISOString()
  return { id: shortId(), name, createdAt: now, updatedAt: now, outputs: [] }
}

export function newOutput(title: string, scene: Scene, turn: Turn): Output {
  return { id: shortId(), title, revision: 1, scene, theatreState: toTheatreState(compile(scene)), history: [turn] }
}

export function reviseOutput(output: Output, scene: Scene, turn: Turn): Output {
  return {
    ...output,
    revision: output.revision + 1,
    scene,
    theatreState: toTheatreState(compile(scene)),
    history: [...output.history, turn],
  }
}

/**
 * Changes (or, with null, removes) one narration line. Beats are timed by their narration, so the
 * animation is re-timed as a new revision. Keyframe edits made in Studio no longer line up and are dropped.
 * An edited line loses its recording until it is recorded again.
 */
export function editNarration(output: Output, index: number, text: string | null): Output {
  const beats =
    text === null
      ? output.scene.beats.filter((_, i) => i !== index)
      : output.scene.beats.map(({ audio, ...beat }, i) => (i === index ? { ...beat, say: text } : { ...beat, ...(audio && { audio }) }))
  return retimed(output, finalizeScene({ ...output.scene, beats, keys: undefined }))
}

/** The output with a re-timed scene, as a new revision (Theatre keeps the old timing under the old id). */
export function retimed(output: Output, scene: Scene): Output {
  if (scene === output.scene) return output
  return { ...output, revision: output.revision + 1, scene, theatreState: toTheatreState(compile(scene)) }
}

/**
 * Theatre keeps one project per id, so every revision gets its own. Studio lists these ids,
 * so they start with the chapter title; Theatre allows at most 32 characters.
 */
export function theatreProjectId(output: Output): string {
  const suffix = ` (${output.id.slice(0, 4)}·r${output.revision})`
  const max = 32 - suffix.length
  const full = output.title.replace(/^\d+\.\s*/, '').trim()
  const title = full.length > max ? full.slice(0, max + 1).replace(/\s+\S*$/, '') : full
  return `${title.slice(0, max) || 'Chapter'}${suffix}`
}
