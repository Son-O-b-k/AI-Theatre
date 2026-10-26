// Recorded narration: every line of a chapter spoken by a voice model on the server.
// Clips are recorded first and applied afterwards, matched by their text, so lines edited
// while recording are simply recorded next time instead of getting the wrong clip.

import type { SpeechClip } from '../shared/protocol'
import { api } from './api'
import { finalizeScene } from './scene/scene'
import type { Scene } from './scene/schema'

/** Narration read live by the browser's own speech instead of a recording. */
export const BROWSER_VOICE = 'browser'

/** Lines of `scene` that have no recording in `voice`. */
export function unrecorded(scene: Scene, voice: string): string[] {
  if (voice === BROWSER_VOICE) return []
  const missing = scene.beats.filter((beat) => beat.say && !(beat.audio && scene.voice === voice))
  return [...new Set(missing.map((beat) => beat.say))]
}

export async function record(
  lines: string[],
  voice: string,
  signal: AbortSignal,
  /** Called before each line with its index. */
  onLine: (index: number) => void,
): Promise<Map<string, SpeechClip>> {
  const clips = new Map<string, SpeechClip>()
  for (const [index, line] of lines.entries()) {
    onLine(index)
    clips.set(line, await api.speak(line, voice, signal))
  }
  return clips
}

/**
 * The scene narrated by `voice`, re-timed to the recordings. Re-timing replaces keyframes edited
 * in Studio, so a scene that is already narrated this way is returned unchanged.
 */
export function withNarration(scene: Scene, voice: string, clips = new Map<string, SpeechClip>()): Scene {
  const browser = voice === BROWSER_VOICE
  if (browser ? !scene.voice : unrecorded(scene, voice).every((line) => !clips.has(line))) return scene
  const beats = scene.beats.map(({ audio, ...beat }) => {
    const kept = !browser && scene.voice === voice ? audio : undefined
    const clip = browser ? undefined : (kept ?? clips.get(beat.say))
    return clip ? { ...beat, audio: clip } : beat
  })
  return finalizeScene({ ...scene, beats, voice: browser ? undefined : voice, keys: undefined })
}
