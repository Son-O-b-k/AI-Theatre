// Run with `npm test`. Creators' pictures: reading, storing, serving and drawing them in video.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { withImages } from '../src/scene/images'
import { compile } from '../src/scene/compile'
import { applyOp, emptyScene, finalizeScene } from '../src/scene/scene'
import { parseOp } from '../src/scene/schema'
import { toTheatreState } from '../src/scene/theatre'
import { FPS, renderFrames } from './exports/frames'
import { creditOf, formatOf, imageFile, saveImage, sizeOf } from './images'
import { imageRoutes } from './routes/images'

/** A picture made by ffmpeg: `source` is a lavfi source such as "color=red:s=400x300". */
async function picture(source: string, extension: string): Promise<Uint8Array> {
  const file = join(await mkdtemp(join(tmpdir(), 'picture-')), `p.${extension}`)
  const made = spawnSync(ffmpegInstaller.path, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', source, '-frames:v', '1', file])
  assert.equal(made.status, 0, made.stderr.toString())
  return new Uint8Array(await readFile(file))
}

describe("creators' pictures", () => {
  test('the format and size are read from the file, whatever its name', async () => {
    const png = await picture('color=red:s=320x200', 'png')
    const jpg = await picture('testsrc=s=640x480', 'jpg')
    assert.equal(formatOf(png), 'png')
    assert.deepEqual(sizeOf(png, 'png'), { width: 320, height: 200 })
    assert.equal(formatOf(jpg), 'jpg')
    assert.deepEqual(sizeOf(jpg, 'jpg'), { width: 640, height: 480 })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xc8, 0x00])
    assert.deepEqual(sizeOf(gif, formatOf(gif)!), { width: 300, height: 200 })
    assert.equal(formatOf(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  })

  test('pictures are stored by content, large ones scaled down, and served to anyone with the link', async () => {
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'images-'))
    const big = await saveImage(await picture('testsrc=s=3000x2000', 'png'))
    assert.match(big.url, /^\/api\/images\/[0-9a-f]{16}\.png$/)
    assert.deepEqual([big.width, big.height], [1920, 1280])
    const small = await saveImage(await picture('color=blue:s=200x100', 'png'), 'Blue by Ada (CC BY 4.0)')
    assert.deepEqual([small.width, small.height, small.credit], [200, 100, 'Blue by Ada (CC BY 4.0)'])
    await assert.rejects(saveImage(new TextEncoder().encode('not a picture')), /PNG, JPEG, WebP or GIF/)

    const app = imageRoutes({ db: undefined as never } as never)
    const served = await app.request(`/${small.url.split('/').pop()}`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.equal((await app.request('/..%2Fapp.db')).status, 404)
    assert.equal((await app.request('/0123456789abcdef.png')).status, 404)
  })

  test("a free picture's credit names its author and licence", () => {
    assert.equal(creditOf({ title: 'Onion cells', creator: 'kaibara87', license: 'by', license_version: '2.0' }), 'Onion cells by kaibara87 (CC BY 2.0)')
    assert.equal(creditOf({ creator: 'NASA', license: 'pdm' }), 'NASA (Public domain)')
  })

  test('a photo is drawn into exported video frames', { timeout: 60_000 }, async () => {
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'images-'))
    const stored = await saveImage(await picture('color=red:s=400x300', 'png'))
    let scene = emptyScene()
    for (const line of [
      { op: 'board', title: 'A red picture', layout: 'row' },
      { op: 'el', id: 'p', kind: 'photo', image: 'img1' },
      { op: 'beat', say: 'Here is a red picture for you to look at.', do: [{ show: 'p' }] },
    ]) {
      scene = applyOp(scene, parseOp(line), () => {})
    }
    scene = finalizeScene(withImages(finalizeScene(scene), [{ id: 'img1', ...stored, about: 'red', look: 'photo', spots: [] }]))
    const resolved = compile(scene)
    const photo = resolved.elements.find((el) => el.id === 'p')!
    const frame = Math.round(3 * FPS)
    let pixels: Uint8Array | null = null
    await renderFrames({
      chapters: [{ scene, theatreState: toTheatreState(resolved) }],
      brand: null,
      captions: false,
      fontFiles: [],
      images: { [stored.url]: new Uint8Array(await readFile(imageFile(stored.url.split('/').pop()!))) },
      from: frame,
      to: frame + 1,
      onFrame: async (drawn) => void (pixels = drawn),
      onProgress: () => {},
    })
    const at = (Math.round(photo.y) * resolved.stage.width + Math.round(photo.x)) * 4
    const [r, g, b] = pixels!.slice(at, at + 3)
    assert.ok(r > 220 && g < 30 && b < 30, `the middle of the photo is the red picture, not ${[r, g, b]}`)
  })
})
