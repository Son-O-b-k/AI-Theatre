// One worker draws one segment of the video and encodes it on its own ffmpeg (see video.ts).

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { parentPort, workerData } from 'node:worker_threads'
import { STAGE } from '../../src/scene/schema'
import { FPS, renderFrames, type RenderOptions } from './frames'

export interface SegmentJob extends Omit<RenderOptions, 'onFrame' | 'onProgress'> {
  ffmpeg: string
  output: string
}

const job = workerData as SegmentJob
const encoder = spawn(job.ffmpeg, [
  '-y', '-loglevel', 'error',
  '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${STAGE.width}x${STAGE.height}`, '-r', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  job.output,
])
let errors = ''
encoder.stderr.on('data', (chunk) => (errors += chunk))
const exited = once(encoder, 'close')

let reported = 0
await renderFrames({
  ...job,
  async onFrame(pixels) {
    if (!encoder.stdin.write(pixels)) await once(encoder.stdin, 'drain')
  },
  onProgress(done) {
    // Report every second of video, not every frame.
    if (done - reported >= FPS) {
      parentPort!.postMessage({ progress: done - reported })
      reported = done
    }
  },
})
encoder.stdin.end()
const [code] = await exited
if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${errors.slice(0, 400)}`)
parentPort!.postMessage({ progress: job.to - job.from - reported, done: true })
