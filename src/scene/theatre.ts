// Converts between a compiled scene and a Theatre.js project state.
// The state is what @theatre/core loads, what Studio edits, and what we export.

import { hexToRgba, rgbaToHex, type Rgba } from './color'
import type { Resolved } from './compile'
import { ANIMATED_PROPS, type AnimatedProp, type Key, type Scene } from './schema'

export const SHEET = 'Lesson'

const FRAMES_PER_SECOND = 30

type Handles = [number, number, number, number]
const HANDLES: Record<Key['ease'], Handles> = {
  smooth: [0.5, 1, 0.5, 0],
  linear: [1, 1, 0, 0],
}

type TheatreValue = number | Rgba

interface TheatreKeyframe {
  id: string
  position: number
  connectedRight: boolean
  handles: Handles
  type: 'bezier'
  value: TheatreValue
}

interface TheatreTracks {
  trackData: Record<string, { type: 'BasicKeyframedTrack'; keyframes: TheatreKeyframe[] }>
  trackIdByPropPath: Record<string, string>
}

interface TheatreSheet {
  staticOverrides: { byObject: Record<string, Partial<Record<string, TheatreValue>>> }
  sequence: {
    type: 'PositionalSequence'
    length: number
    subUnitsPerUnit: number
    tracksByObject: Record<string, TheatreTracks>
  }
}

export interface TheatreState {
  sheetsById: Record<string, TheatreSheet>
  definitionVersion: string
  revisionHistory: string[]
}

export function toTheatreState(resolved: Resolved): TheatreState {
  const tracksByObject: Record<string, TheatreTracks> = {}

  for (const key of [...resolved.keys].sort((a, b) => a.t - b.t)) {
    const tracks = (tracksByObject[key.el] ??= { trackData: {}, trackIdByPropPath: {} })
    const trackId = `${key.el}.${key.prop}`
    tracks.trackIdByPropPath[JSON.stringify([key.prop])] = trackId
    const track = (tracks.trackData[trackId] ??= { type: 'BasicKeyframedTrack', keyframes: [] })

    const position = Math.round(key.t * FRAMES_PER_SECOND) / FRAMES_PER_SECOND
    const keyframe: TheatreKeyframe = {
      id: `${trackId}@${position}`,
      position,
      connectedRight: true,
      handles: HANDLES[key.ease],
      type: 'bezier',
      value: toTheatreValue(key.prop, key.v),
    }
    // Two keys on the same frame: the later one wins.
    const last = track.keyframes.at(-1)
    if (last?.position === position) track.keyframes[track.keyframes.length - 1] = keyframe
    else track.keyframes.push(keyframe)
  }

  return {
    sheetsById: {
      [SHEET]: {
        staticOverrides: { byObject: {} },
        sequence: {
          type: 'PositionalSequence',
          length: resolved.duration,
          subUnitsPerUnit: FRAMES_PER_SECOND,
          tracksByObject,
        },
      },
    },
    definitionVersion: '0.4.0',
    revisionHistory: [crypto.randomUUID()],
  }
}

/**
 * Reads edits made in Theatre Studio back into the scene. The edited keyframes replace the ones
 * derived from the beats; a value changed without keyframes becomes a single key at time 0.
 */
export function fromTheatreState(scene: Scene, state: TheatreState): Scene {
  const sheet = state.sheetsById[SHEET]
  if (!sheet) return scene

  const keys: Key[] = []
  for (const [el, tracks] of Object.entries(sheet.sequence.tracksByObject)) {
    for (const [path, trackId] of Object.entries(tracks.trackIdByPropPath)) {
      const [prop] = JSON.parse(path) as [AnimatedProp]
      if (!ANIMATED_PROPS.includes(prop)) continue
      for (const keyframe of tracks.trackData[trackId]?.keyframes ?? []) {
        keys.push({
          el,
          prop,
          t: round(keyframe.position),
          v: fromTheatreValue(prop, keyframe.value),
          ease: keyframe.handles[2] === 0 && keyframe.handles[3] === 0 ? 'linear' : 'smooth',
        })
      }
    }
  }
  for (const [el, overrides] of Object.entries(sheet.staticOverrides.byObject)) {
    for (const prop of ANIMATED_PROPS) {
      const value = overrides[prop]
      const animated = keys.some((key) => key.el === el && key.prop === prop)
      if (value !== undefined && !animated) keys.push({ el, prop, t: 0, v: fromTheatreValue(prop, value), ease: 'smooth' })
    }
  }
  return { ...scene, keys }
}

function toTheatreValue(prop: AnimatedProp, value: number | string): TheatreValue {
  return prop === 'color' ? hexToRgba(String(value)) : Number(value)
}

function fromTheatreValue(prop: AnimatedProp, value: TheatreValue): number | string {
  return prop === 'color' ? rgbaToHex(value as Rgba) : round(value as number)
}

const round = (n: number) => Math.round(n * 100) / 100
