// Narration. Kokoro, a small open-source voice model, runs on this machine for English; premium
// voices (Pro and Teams, any language) come from an OpenAI-compatible speech API set in .env:
//   PREMIUM_TTS_API_KEY (or OPENAI_API_KEY), PREMIUM_TTS_BASE_URL, PREMIUM_TTS_MODEL
// Kokoro's model (~90 MB) is downloaded on first use. Every clip is cached by voice and text,
//   data/speech/<hash>.wav (16-bit mono, 24 kHz)
// so recording a lesson again only records the sentences that changed.

import { createHash } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '@huggingface/transformers'
import { HTTPException } from 'hono/http-exception'
import { KokoroTTS } from 'kokoro-js'
import type { SpeechClip, VoiceInfo } from '../shared/protocol'

// Read when used: this module loads before the server reads .env.
const clipsDir = () => join(resolve(process.env.DATA_DIR ?? 'data'), 'speech')

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const SAMPLE_RATE = 24_000
const WAV_HEADER = 44

/** The voices Kokoro rates best, best first. */
const KOKORO_VOICES: VoiceInfo[] = [
  { id: 'af_heart', label: 'Heart · American' },
  { id: 'af_bella', label: 'Bella · American' },
  { id: 'af_nicole', label: 'Nicole · American, soft' },
  { id: 'bf_emma', label: 'Emma · British' },
  { id: 'am_michael', label: 'Michael · American' },
  { id: 'am_fenrir', label: 'Fenrir · American' },
  { id: 'am_puck', label: 'Puck · American' },
  { id: 'bm_george', label: 'George · British' },
]

/** Premium voices speak every supported language; ids are "premium:<voice>". */
const PREMIUM_VOICES: VoiceInfo[] = [
  ['coral', 'Coral · warm'],
  ['sage', 'Sage · calm'],
  ['nova', 'Nova · bright'],
  ['alloy', 'Alloy · neutral'],
  ['echo', 'Echo · deep'],
  ['onyx', 'Onyx · rich'],
].map(([id, label]) => ({ id: `premium:${id}`, label, premium: true }))

export const isPremium = (voice: string) => voice.startsWith('premium:')

function premiumConfig() {
  const apiKey = process.env.PREMIUM_TTS_API_KEY ?? process.env.OPENAI_API_KEY
  return apiKey
    ? {
        apiKey,
        baseUrl: (process.env.PREMIUM_TTS_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
        model: process.env.PREMIUM_TTS_MODEL ?? 'gpt-4o-mini-tts',
      }
    : null
}

export const premiumAvailable = () => premiumConfig() !== null

/** Voices this server can use: premium ones only when a speech API is set up. */
export const voices = (): VoiceInfo[] => [...KOKORO_VOICES, ...(premiumAvailable() ? PREMIUM_VOICES : [])]

type Voice = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

let model: Promise<KokoroTTS> | null = null
/** The model works on one sentence at a time; requests wait their turn. */
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<KokoroTTS> {
  env.cacheDir = join(resolve(process.env.DATA_DIR ?? 'data'), 'models')
  model ??= KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' }).catch((error) => {
    model = null // try again on the next request
    throw error
  })
  return model
}

export const clipFile = (name: string) => {
  if (!/^[0-9a-f]{16}\.wav$/.test(name)) throw new HTTPException(400, { message: `Invalid clip: ${name}` })
  return join(clipsDir(), name)
}

export async function speak(text: string, voice: string): Promise<SpeechClip> {
  if (!voices().some((v) => v.id === voice)) throw new HTTPException(400, { message: `Unknown voice: ${voice}` })
  const name = `${createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16)}.wav`
  const file = clipFile(name)
  const url = `/api/speech/${name}`

  const cached = await stat(file).catch(() => null)
  if (cached) return { url, seconds: (cached.size - WAV_HEADER) / 2 / SAMPLE_RATE }

  const save = async (samples: Float32Array, rate: number) => {
    await mkdir(clipsDir(), { recursive: true })
    await writeFile(`${file}.tmp`, toWav(samples, rate))
    await rename(`${file}.tmp`, file)
    return { url, seconds: samples.length / rate }
  }

  if (isPremium(voice)) return save(await premiumSpeech(text, voice.slice('premium:'.length)), SAMPLE_RATE)

  const run = queue.then(async () => {
    const tts = await load()
    const audio = await tts.generate(text, { voice: voice as Voice })
    return save(audio.audio, audio.sampling_rate)
  })
  queue = run.catch(() => {})
  return run
}

/** One line from the premium speech API, as raw 24 kHz 16-bit samples ("pcm"). */
async function premiumSpeech(text: string, voice: string): Promise<Float32Array> {
  const config = premiumConfig()
  if (!config) throw new HTTPException(400, { message: 'Premium voices are not set up on this server.' })
  const response = await fetch(`${config.baseUrl}/audio/speech`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      voice,
      input: text,
      response_format: 'pcm',
      instructions: 'Speak like a warm, clear teacher explaining an idea step by step.',
    }),
  })
  if (!response.ok) throw new Error(`Premium voice failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
  const pcm = new Int16Array(await response.arrayBuffer())
  return Float32Array.from(pcm, (sample) => sample / 32768)
}

/** 16-bit mono PCM: half the size of the float samples the model produces, and plays everywhere. */
function toWav(samples: Float32Array, rate: number): Uint8Array {
  const data = samples.length * 2
  const view = new DataView(new ArrayBuffer(WAV_HEADER + data))
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + data, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, data, true)
  samples.forEach((s, i) => view.setInt16(WAV_HEADER + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true))
  return new Uint8Array(view.buffer)
}
