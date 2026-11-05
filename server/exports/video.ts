// MP4 export: the lesson's chapters as one video with its recorded narration, any soundtracks,
// and captions burned in. Frames are drawn in parallel worker threads, each encoding a segment;
// the segments are joined without re-encoding and the audio is added last.

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import type { Brand } from '../../shared/protocol'
import { compile } from '../../src/scene/compile'
import type { Scene } from '../../src/scene/schema'
import type { TheatreState } from '../../src/scene/theatre'
import { newId } from '../db'
import { clipFile } from '../speech'
import { interFonts } from './fonts'
import { chapterFrames, FPS } from './frames'
import type { SegmentJob } from './video-worker'

const SAMPLE_RATE = 24_000
/** Soundtracks play under the narration. */
const SOUNDTRACK_VOLUME = 0.3

export interface VideoChapter {
  scene: Scene
  theatreState: TheatreState
  /** Path of the chapter's soundtrack file, if any. */
  soundtrack?: string
}

export interface VideoOptions {
  chapters: VideoChapter[]
  /** The brand, with its logo as a data URL (the renderer cannot fetch). */
  brand: Brand | null
  captions: boolean
  output: string
  signal?: AbortSignal
  onProgress(share: number): void
}

const ffmpeg = ffmpegInstaller.path

async function run(args: string[], signal?: AbortSignal): Promise<void> {
  const child = spawn(ffmpeg, ['-y', '-loglevel', 'error', ...args], { signal })
  let errors = ''
  child.stderr.on('data', (chunk) => (errors += chunk))
  const [code] = await once(child, 'close')
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${errors.slice(0, 400)}`)
}

/** PCM samples of one of our clips (16-bit mono WAV, see server/speech.ts). */
async function clipSamples(url: string): Promise<Int16Array | null> {
  const data = await readFile(clipFile(url.split('/').pop()!)).catch(() => null)
  if (!data) return null
  const at = data.indexOf('data') + 8 // the samples follow the "data" chunk header
  return new Int16Array(data.buffer.slice(data.byteOffset + at, data.byteOffset + data.length - ((data.length - at) % 2)))
}

/** The narration: each line's recording at its cue's time, in one WAV. */
async function narrationTrack(chapters: VideoChapter[], offsets: number[], duration: number, file: string): Promise<void> {
  const mix = new Float32Array(Math.ceil(duration * SAMPLE_RATE))
  for (const [i, chapter] of chapters.entries()) {
    for (const cue of chapter.scene.cues) {
      if (!cue.audio) continue
      const samples = await clipSamples(cue.audio)
      if (!samples) continue
      const start = Math.round((offsets[i] + cue.t) * SAMPLE_RATE)
      for (let s = 0; s < samples.length && start + s < mix.length; s++) mix[start + s] += samples[s] / 32768
    }
  }
  const header = Buffer.alloc(44)
  const bytes = mix.length * 2
  header.write('RIFF', 0, 'latin1')
  header.writeUInt32LE(36 + bytes, 4)
  header.write('WAVEfmt ', 8, 'latin1')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'latin1')
  header.writeUInt32LE(bytes, 40)
  const pcm = Buffer.alloc(bytes)
  mix.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2))
  await writeFile(file, Buffer.concat([header, pcm]))
}

export async function exportVideo(options: VideoOptions): Promise<void> {
  const work = join(tmpdir(), `ai-theatre-video-${newId()}`)
  await mkdir(work, { recursive: true })
  try {
    // Timing comes from the compiled scenes; chapters follow one another.
    const durations = options.chapters.map((c) => chapterFrames(compile(c.scene).duration) / FPS)
    const offsets = durations.map((_, i) => durations.slice(0, i).reduce((a, b) => a + b, 0))
    const duration = durations.reduce((a, b) => a + b, 0)
    const totalFrames = Math.round(duration * FPS)

    // Each worker draws a contiguous range, so segments can be joined in order.
    const workers = Math.max(1, Math.min(availableParallelism() - 2, Math.ceil(totalFrames / (FPS * 10))))
    const size = Math.ceil(totalFrames / workers)
    const fontFiles = await interFonts()
    let rendered = 0
    const segments = Array.from({ length: workers }, (_, i) => join(work, `segment-${i}.mp4`))
    await Promise.all(
      segments.map((output, i) => {
        const job: SegmentJob = {
          chapters: options.chapters.map(({ scene, theatreState }) => ({ scene, theatreState })),
          brand: options.brand,
          captions: options.captions,
          fontFiles,
          from: i * size,
          to: Math.min(totalFrames, (i + 1) * size),
          ffmpeg,
          output,
        }
        return new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('./video-worker.ts', import.meta.url), { workerData: job })
          options.signal?.addEventListener('abort', () => worker.terminate())
          worker.on('message', (message: { progress: number; done?: boolean }) => {
            rendered += message.progress
            options.onProgress(Math.min(0.95, (rendered / totalFrames) * 0.95))
            if (message.done) resolve()
          })
          worker.on('error', reject)
          worker.on('exit', (code) => (options.signal?.aborted ? reject(new Error('Export stopped')) : code !== 0 && reject(new Error(`Renderer exited with ${code}`))))
        })
      }),
    )

    // Join the segments and add the sound.
    await writeFile(join(work, 'segments.txt'), segments.map((s) => `file '${s}'`).join('\n'))
    await narrationTrack(options.chapters, offsets, duration, join(work, 'narration.wav'))
    const soundtracks = options.chapters.flatMap((c, i) => (c.soundtrack ? [{ file: c.soundtrack, offset: offsets[i], duration: durations[i] }] : []))
    const inputs = ['-f', 'concat', '-safe', '0', '-i', join(work, 'segments.txt'), '-i', join(work, 'narration.wav')]
    for (const track of soundtracks) inputs.push('-i', track.file)
    const audio = soundtracks.length
      ? [
          '-filter_complex',
          soundtracks
            .map((t, i) => `[${i + 2}:a]atrim=0:${t.duration.toFixed(2)},adelay=${Math.round(t.offset * 1000)}:all=1,volume=${SOUNDTRACK_VOLUME}[s${i}]`)
            .join(';') + `;[1:a]${soundtracks.map((_, i) => `[s${i}]`).join('')}amix=inputs=${soundtracks.length + 1}:normalize=0[audio]`,
          '-map', '0:v', '-map', '[audio]',
        ]
      : ['-map', '0:v', '-map', '1:a']
    await run([...inputs, ...audio, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', options.output], options.signal)
    options.onProgress(1)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}
