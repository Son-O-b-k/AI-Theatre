import { compile } from './scene/compile'
import { finalizeScene } from './scene/scene'
import { DEFAULT_FORMAT, SCENE_VERSION, type Format, type Look, type Scene } from './scene/schema'
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
  /** The language its chapters are written and narrated in (shared/languages.ts); English when unset. */
  language?: string
  /** The shape of its stage and video (src/scene/schema.ts); landscape when unset. */
  format?: Format
  /** How its chapters are drawn (chalkboard or marker); chalkboard when unset. */
  look?: Look
  outputs: Output[]
}

/** A lesson's format: its own, or its first chapter's (lessons from before the setting existed). */
export const lessonFormat = (project: Pick<Project, 'format' | 'outputs'>): Format =>
  project.format ?? project.outputs[0]?.scene.format ?? DEFAULT_FORMAT

/** Chapters whose motion was fine-tuned in Studio; changing the format lays them out again and drops it. */
export const fineTuned = (project: Project) => project.outputs.filter((o) => o.scene.keys)

/**
 * The lesson in another format: every chapter is laid out again for the new stage, so keyframes
 * fine-tuned in Studio are dropped. Chapters in an older scene format are left as they are.
 */
export function reformatted(project: Project, format: Format): Project {
  return {
    ...project,
    format,
    outputs: project.outputs.map((o) =>
      o.scene.version === SCENE_VERSION && (o.scene.format ?? DEFAULT_FORMAT) !== format ? retimed(o, { ...o.scene, format, keys: undefined }) : o,
    ),
  }
}

/**
 * The lesson drawn another way. Layout and timing do not change, so fine-tuned motion is kept; each
 * chapter becomes a new revision so the player draws it again.
 */
export function restyled(project: Project, look: Look): Project {
  return {
    ...project,
    look,
    outputs: project.outputs.map((o) => ((o.scene.look ?? 'chalk') === look ? o : { ...o, revision: o.revision + 1, scene: { ...o.scene, look } })),
  }
}

/** A chapter drawn the lesson's way, when it arrives from the AI. */
export const inLessonLook = (project: Pick<Project, 'look'>, output: Output): Output =>
  project.look && (output.scene.look ?? 'chalk') !== project.look ? { ...output, scene: { ...output.scene, look: project.look } } : output

export const shortId = () => crypto.randomUUID().slice(0, 8)

/** A chapter or lesson title from the prompt that made it. */
export const titleFrom = (prompt: string) => (prompt.length > 48 ? `${prompt.slice(0, 45)}…` : prompt)

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

/**
 * A change from the chapter editor (src/scene/edit.ts). Like a narration edit, the chapter is laid out
 * and timed again, which replaces keyframes fine-tuned in Studio.
 */
export function editScene(output: Output, scene: Scene): Output {
  return retimed(output, finalizeScene({ ...scene, keys: undefined }))
}

/** The output with a re-timed scene, as a new revision (Theatre keeps the old timing under the old id). */
export function retimed(output: Output, scene: Scene): Output {
  if (scene === output.scene) return output
  return { ...output, revision: output.revision + 1, scene, theatreState: toTheatreState(compile(scene)) }
}

/**
 * Theatre keeps one project per id, so every revision (and its branded copy) gets its own. Studio lists these ids,
 * so they start with the chapter title; Theatre allows at most 32 characters.
 */
export function theatreProjectId(output: Pick<Output, 'id' | 'title' | 'revision'>, branded = false): string {
  // A branded copy has other colours, so Theatre must hold it as a separate project.
  const suffix = ` (${output.id.slice(0, 4)}·${branded ? 'b' : 'r'}${output.revision})`
  const max = 32 - suffix.length
  const full = output.title.replace(/^\d+\.\s*/, '').trim()
  const title = full.length > max ? full.slice(0, max + 1).replace(/\s+\S*$/, '') : full
  return `${title.slice(0, max) || 'Chapter'}${suffix}`
}
