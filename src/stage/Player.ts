// Transport for one mounted scene: play/pause/seek plus spoken narration.
// Lines are played from their recording, or read by the browser when they have none.
// When a sentence is still being spoken as the next cue arrives, the timeline waits for it,
// so the visuals never run ahead of the explanation.

import { onChange, val, type ISequence } from '@theatre/core'
import type { Cue } from '../scene/schema'

const WORDS_PER_SECOND = 2.5
/** Larger forward steps than this between two updates are treated as a seek. */
const MAX_FRAME_STEP = 1

export interface PlayerEvents {
  /** Index of the narration line being shown, or null before the first one. */
  onCue(index: number | null): void
  onPlayingChange(playing: boolean): void
  onTime(seconds: number): void
  /** Playback reached the end (and the last sentence finished). */
  onEnded(): void
}

export class Player {
  private cues: Cue[] = []
  private nextCue = 0
  private lastPosition = 0
  private playing = false
  private waitingForSpeech = false
  private endAfterSpeech = false
  private speech: Speech | null = null
  /** Recordings by URL, loaded ahead so each line starts on time. */
  private clips = new Map<string, HTMLAudioElement>()
  private narrate = true
  /** Bumped by every pause, so callbacks from an earlier play() can tell they are stale. */
  private generation = 0
  private audioReady: Promise<unknown> = Promise.resolve()
  private readonly unsubscribe: () => void

  constructor(
    private readonly sequence: ISequence,
    cues: Cue[],
    private readonly events: PlayerEvents,
    /** Resolves when Theatre has loaded the project; with Studio this is not instant. */
    private readonly projectReady: Promise<unknown> = Promise.resolve(),
  ) {
    this.setCues(cues)
    this.unsubscribe = onChange(sequence.pointer.position, (position) => this.onPosition(position))
  }

  get duration(): number {
    return val(this.sequence.pointer.length)
  }

  /** Cues must be sorted by time (finalizeScene does this). */
  setCues(cues: Cue[]): void {
    this.cues = cues
    for (const { audio: url } of cues) {
      if (url && !this.clips.has(url)) this.clips.set(url, Object.assign(new Audio(url), { preload: 'auto' }))
    }
    this.seekCue(this.sequence.position)
  }

  setNarration(on: boolean): void {
    this.narrate = on
    if (!on) this.stopSpeech()
  }

  /** Theatre keeps the sequence in sync with the track once it has loaded. */
  attachAudio(url: string): void {
    this.audioReady = this.sequence.attachAudio({ source: url }).catch((error) => {
      console.error(`Could not load sound ${url}`, error)
    })
  }

  async play(): Promise<void> {
    if (this.playing) return
    this.setPlaying(true)
    const generation = this.generation
    await Promise.all([this.projectReady, this.audioReady])
    if (generation !== this.generation) return
    if (this.sequence.position >= this.duration - 0.01) this.sequence.position = 0
    this.run()
  }

  pause(): void {
    this.generation++
    this.setPlaying(false)
    this.waitingForSpeech = false
    this.endAfterSpeech = false
    this.sequence.pause()
    this.stopSpeech()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(seconds: number): void {
    const wasPlaying = this.playing
    this.pause()
    const target = Math.min(Math.max(0, seconds), this.duration)
    this.sequence.position = target
    this.lastPosition = target
    this.seekCue(target)
    if (wasPlaying) this.play()
  }

  dispose(): void {
    this.pause()
    this.unsubscribe()
    this.clips.clear()
  }

  private run(): void {
    const generation = this.generation
    this.sequence.play().then((finished) => {
      // Stale (paused since), or paused to wait for speech: neither is the end of playback.
      if (generation !== this.generation || this.waitingForSpeech) return
      this.setPlaying(false)
      if (!finished) return
      if (this.speech) this.endAfterSpeech = true
      else this.events.onEnded()
    })
  }

  private onPosition(position: number): void {
    this.events.onTime(position)
    // Normal playback advances a frame at a time; anything else is a seek (e.g. scrubbing in Studio).
    const jumped = position < this.lastPosition || position - this.lastPosition > MAX_FRAME_STEP
    this.lastPosition = position

    if (!this.playing || jumped) {
      if (jumped) this.stopSpeech()
      this.seekCue(position)
      return
    }

    const cue = this.cues[this.nextCue]
    if (!cue || position < cue.t) return

    if (this.speech) {
      this.waitingForSpeech = true
      this.sequence.pause()
      return
    }
    this.say(this.nextCue++)
  }

  /** Re-syncs the cue index after a jump in time. */
  private seekCue(position: number): void {
    const next = this.cues.findIndex((cue) => cue.t >= position)
    this.nextCue = next === -1 ? this.cues.length : next
    this.events.onCue(this.nextCue > 0 ? this.nextCue - 1 : null)
  }

  private say(index: number): void {
    this.events.onCue(index)
    if (!this.narrate) return

    const { text, audio: url } = this.cues[index]
    const clip = url ? this.clips.get(url) : undefined
    let speech: Speech | null = null
    const finish = () => {
      if (this.speech !== speech) return
      this.speech = null
      this.afterSpeech()
    }
    speech = clip ? playClip(clip, finish) : readAloud(text, finish)
    this.speech = speech
  }

  private stopSpeech(): void {
    const speech = this.speech
    this.speech = null
    speech?.stop()
    this.afterSpeech()
  }

  private afterSpeech(): void {
    if (this.endAfterSpeech) {
      this.endAfterSpeech = false
      this.events.onEnded()
    }
    if (!this.waitingForSpeech) return
    this.waitingForSpeech = false
    if (this.playing) this.run()
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) return
    this.playing = playing
    this.events.onPlayingChange(playing)
  }
}

interface Speech {
  stop(): void
}

function playClip(clip: HTMLAudioElement, onEnd: () => void): Speech {
  clip.currentTime = 0
  clip.onended = clip.onerror = onEnd
  clip.play().catch(onEnd) // e.g. autoplay blocked: carry on without the line
  return {
    stop() {
      clip.onended = clip.onerror = null
      clip.pause()
    },
  }
}

function readAloud(text: string, onEnd: () => void): Speech | null {
  if (!('speechSynthesis' in window)) return null
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = bestBrowserVoice()
  // Some browsers never fire `end` (no voices installed, tab in background); never wait forever.
  const fallback = setTimeout(onEnd, (text.split(/\s+/).length / WORDS_PER_SECOND) * 1500 + 2000)
  utterance.onend = utterance.onerror = () => {
    clearTimeout(fallback)
    onEnd()
  }
  speechSynthesis.speak(utterance)
  return {
    stop() {
      clearTimeout(fallback)
      utterance.onend = utterance.onerror = null
      speechSynthesis.cancel()
    },
  }
}

/** The system's own default is often its most robotic voice; prefer the neural ones when installed. */
function bestBrowserVoice(): SpeechSynthesisVoice | null {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
  const rank = (v: SpeechSynthesisVoice) =>
    /premium/i.test(v.name) ? 3 : /enhanced|natural|neural/i.test(v.name) ? 2 : /google/i.test(v.name) ? 1 : 0
  const best = english.sort((a, b) => rank(b) - rank(a))[0]
  return best && rank(best) > 0 ? best : null
}
