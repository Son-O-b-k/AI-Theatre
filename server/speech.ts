// Narration with Kokoro, a small open-source voice model that runs on this machine.
// The model (~90 MB) is downloaded on first use. Clips are cached by voice and text,
//   data/speech/<hash>.wav
// so recording a lesson again only records the sentences that changed.

import { createHash } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { env } from '@huggingface/transformers'
import { HTTPException } from 'hono/http-exception'
import { KokoroTTS } from 'kokoro-js'
import type { SpeechClip, VoiceInfo } from '../shared/protocol'

const ROOT = resolve(process.env.DATA_DIR ?? 'data')
const CLIPS = join(ROOT, 'speech')
env.cacheDir = join(ROOT, 'models')

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const SAMPLE_RATE = 24_000
const WAV_HEADER = 44

/** The voices Kokoro rates best, best first. */
export const VOICES: VoiceInfo[] = [
  { id: 'af_heart', label: 'Heart · American' },
  { id: 'af_bella', label: 'Bella · American' },
  { id: 'af_nicole', label: 'Nicole · American, soft' },
  { id: 'bf_emma', label: 'Emma · British' },
  { id: 'am_michael', label: 'Michael · American' },
  { id: 'am_fenrir', label: 'Fenrir · American' },
  { id: 'am_puck', label: 'Puck · American' },
  { id: 'bm_george', label: 'George · British' },
]

type Voice = NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']

let model: Promise<KokoroTTS> | null = null
/** The model works on one sentence at a time; requests wait their turn. */
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<KokoroTTS> {
  model ??= KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' }).catch((error) => {
    model = null // try again on the next request
    throw error
  })
  return model
}

export const clipFile = (name: string) => {
  if (!/^[0-9a-f]{16}\.wav$/.test(name)) throw new HTTPException(400, { message: `Invalid clip: ${name}` })
  return join(CLIPS, name)
}

export async function speak(text: string, voice: string): Promise<SpeechClip> {
  if (!VOICES.some((v) => v.id === voice)) throw new HTTPException(400, { message: `Unknown voice: ${voice}` })
  const name = `${createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16)}.wav`
  const file = clipFile(name)
  const url = `/api/speech/${name}`

  const cached = await stat(file).catch(() => null)
  if (cached) return { url, seconds: (cached.size - WAV_HEADER) / 2 / SAMPLE_RATE }

  const run = queue.then(async () => {
    const tts = await load()
    const audio = await tts.generate(text, { voice: voice as Voice })
    await mkdir(CLIPS, { recursive: true })
    await writeFile(`${file}.tmp`, toWav(audio.audio, audio.sampling_rate))
    await rename(`${file}.tmp`, file)
    return { url, seconds: audio.audio.length / audio.sampling_rate }
  })
  queue = run.catch(() => {})
  return run
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
