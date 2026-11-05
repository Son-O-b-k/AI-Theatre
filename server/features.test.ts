// Run with `npm test`. The plan features: sharing, branding, own AI providers, single sign-on,
// and the exports (keyframe sampling, ZIP, a short real MP4 and a SCORM package).

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { LESSON_TOKENS } from '../shared/plans'
import { inLanguage } from '../src/ai/prompts'
import { newOutput, type Output, type Project } from '../src/project'
import { brandResolved, brandTheatreState } from '../src/scene/brand'
import { hexToRgba, rgbaToCss } from '../src/scene/color'
import { compile } from '../src/scene/compile'
import { PALETTE } from '../src/scene/palette'
import { sampleAt } from '../src/scene/sample'
import { applyOp, emptyScene, finalizeScene } from '../src/scene/scene'
import { parseOp } from '../src/scene/schema'
import { SHEET, toTheatreState } from '../src/scene/theatre'
import { markVerified, signIn, signUp, workspacesOf, type Account } from './accounts'
import { setManualPlan } from './admin'
import { OWN_KEY_USAGE, recordUsage, tokensUsedSince } from './billing/repo'
import { DevBillingProvider } from './billing/providers/dev'
import { Billing } from './billing/service'
import { BrandColorsSchema, effectiveBrand, setBrandColors } from './brand'
import type { Db } from './db'
import { exportScorm } from './exports/scorm'
import { exportVideo } from './exports/video'
import { zip } from './exports/zip'
import { decrypt, encrypt } from './secrets'
import { revokeShare, shareProject, sharedLesson } from './shares'
import { speak, voices } from './speech'
import { completeLogin, saveConnection, ssoFor, startLogin } from './sso'
import * as store from './store'
import { freshDb } from './test-db'
import { addWorkspaceProvider, listWorkspaceProviders, workspaceProvider } from './workspace-providers'

const inAYear = () => new Date(Date.now() + 365 * 86_400_000)

/** A short two-beat chapter, written as a model would. */
function chapter(title = 'Tokens'): Output {
  let scene = emptyScene()
  for (const line of [
    { op: 'board', title: 'Words become tokens', layout: 'row' },
    { op: 'el', id: 'a', kind: 'box', label: 'The', color: 'teal' },
    { op: 'el', id: 'b', kind: 'box', label: 'cat', color: 'amber' },
    { op: 'beat', say: 'A model reads text as tokens.', do: [{ show: ['a', 'b'] }] },
    { op: 'beat', say: 'Each one becomes a number.', do: [{ highlight: 'a', color: 'blue' }] },
  ]) {
    scene = applyOp(scene, parseOp(line), () => {})
  }
  return newOutput(title, finalizeScene(scene), { prompt: 'secret prompt', provider: 'p', model: 'm', at: '' })
}

describe('plan features', () => {
  let db: Db
  let billing: Billing
  let owner: Account

  beforeEach(async () => {
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'features-'))
    db = await freshDb()
    billing = new Billing(db, new DevBillingProvider())
    owner = await signUp(db, 'owner@school.example', 'owner password')
  })

  afterEach(() => db.close())

  test('a shared lesson shows its chapters, not its prompts, and stops when revoked or the plan ends', async () => {
    const project: Project = { id: 'p1', name: 'How models read', createdAt: '', updatedAt: '', outputs: [chapter()] }
    await store.writeProject(owner.workspaceId, 'p1', project)
    await setManualPlan(db, owner.workspaceId, 'creator', null, inAYear())

    const share = await shareProject(db, owner, 'p1')
    assert.equal((await shareProject(db, owner, 'p1')).id, share.id, 'one link per lesson')
    const lesson = await sharedLesson(db, billing, share.id)
    assert.equal(lesson.title, 'How models read')
    assert.equal(lesson.chapters.length, 1)
    assert.ok(!JSON.stringify(lesson).includes('secret prompt'))

    await setManualPlan(db, owner.workspaceId, 'free', null, inAYear())
    await assert.rejects(sharedLesson(db, billing, share.id), /no longer shared/)
    await setManualPlan(db, owner.workspaceId, 'creator', null, inAYear())
    await revokeShare(db, owner.workspaceId, share.id)
    await assert.rejects(sharedLesson(db, billing, share.id), /no longer shared/)
  })

  test('a brand recolours lessons when the plan includes it', async () => {
    const brand = await setBrandColors(db, owner.workspaceId, BrandColorsSchema.parse({ background: '#FFFFFF', primary: '#0a7d4f', highlight: '#e11d48' }))
    assert.equal(await effectiveBrand(db, billing, owner.workspaceId), null, 'Free has no branding')
    await setManualPlan(db, owner.workspaceId, 'pro', null, inAYear())
    assert.deepEqual(await effectiveBrand(db, billing, owner.workspaceId), brand)

    const output = chapter()
    const branded = brandResolved(compile(output.scene), brand)
    assert.equal(branded.background, '#ffffff')
    assert.equal(branded.ink?.text, '#1d1b17', 'dark text on a light stage')
    assert.equal(branded.elements.find((e) => e.id === 'b')?.color, '#e11d48', 'amber became the highlight colour')
    const state = JSON.stringify(brandTheatreState(output.theatreState, brand))
    assert.ok(state.includes(JSON.stringify(hexToRgba('#0a7d4f')).slice(1, -1)), 'the blue highlight keyframe became the main colour')
    assert.ok(!state.includes(JSON.stringify(hexToRgba(PALETTE.blue)).slice(1, -1)))
  })

  test('secrets are encrypted, and tampering is detected', () => {
    const sealed = encrypt('sk-very-secret')
    assert.ok(!sealed.includes('very-secret'))
    assert.equal(decrypt(sealed), 'sk-very-secret')
    const [v, iv, tag, data] = sealed.split(':')
    assert.throws(() => decrypt([v, iv, tag, Buffer.from('tampered').toString('base64') + data].join(':')))
  })

  test("a workspace's own provider keeps its key private and does not use the allowance", async () => {
    const added = await addWorkspaceProvider(db, owner.workspaceId, { label: 'Our OpenAI', kind: 'openai', apiKey: 'sk-ours', models: ['gpt-x'] })
    assert.equal(added.hasKey, true)
    assert.ok(!JSON.stringify(await listWorkspaceProviders(db, owner.workspaceId)).includes('sk-ours'))
    const raw = await db.get<{ api_key: string }>('SELECT api_key FROM workspace_providers')
    assert.ok(!raw!.api_key.includes('sk-ours'), 'stored encrypted')
    assert.deepEqual(await (await workspaceProvider(db, owner.workspaceId, added.id)).listModels(), ['gpt-x'])

    await recordUsage(db, owner.workspaceId, OWN_KEY_USAGE, 10 * LESSON_TOKENS)
    await recordUsage(db, owner.workspaceId, 'chat', 1000)
    assert.equal(await tokensUsedSince(db, owner.workspaceId, '2000-01-01'), 1000)
  })

  describe('single sign-on', () => {
    let idp: Server
    let issuer: string
    const codes = new Map<string, { nonce: string; email: string }>()

    before(async () => {
      const { publicKey, privateKey } = await generateKeyPair('RS256')
      const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
      idp = createServer(async (req, res) => {
        const url = new URL(req.url!, issuer)
        const json = (body: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
        if (url.pathname === '/.well-known/openid-configuration') {
          return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` })
        }
        if (url.pathname === '/jwks') return json({ keys: [jwk] })
        if (url.pathname === '/token') {
          let body = ''
          for await (const chunk of req) body += chunk
          const form = new URLSearchParams(body)
          const grant = codes.get(form.get('code')!)
          if (!grant || form.get('client_secret') !== 'shh' || !form.get('code_verifier')) return res.writeHead(400).end()
          const idToken = await new SignJWT({ email: grant.email, email_verified: true, nonce: grant.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
            .setIssuer(issuer)
            .setAudience('client-1')
            .setSubject(grant.email)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
          return json({ id_token: idToken, token_type: 'Bearer' })
        }
        res.writeHead(404).end()
      })
      await new Promise<void>((resolve) => idp.listen(0, '127.0.0.1', resolve))
      issuer = `http://127.0.0.1:${(idp.address() as { port: number }).port}`
    })

    after(() => idp.close())

    /** What the identity provider does after the person signs in: issue a code for this login. */
    const signInAtProvider = (url: string, email: string) => {
      const params = new URL(url).searchParams
      const code = `code-${codes.size}`
      codes.set(code, { nonce: params.get('nonce')!, email })
      return { state: params.get('state')!, code }
    }

    test('people from the domain sign in, get an account and a seat; the state works once', async () => {
      await setManualPlan(db, owner.workspaceId, 'teams', 3, inAYear())
      await assert.rejects(
        saveConnection(db, { ...owner, email: 'owner@elsewhere.example' }, { domain: 'school.example', issuer, clientId: 'client-1', clientSecret: 'shh', enforced: false }),
        /Your own email must be on school.example/,
      )
      await saveConnection(db, owner, { domain: 'school.example', issuer, clientId: 'client-1', clientSecret: 'shh', enforced: true })
      assert.deepEqual(await ssoFor(db, 'grace@School.example'), { sso: true, enforced: true })

      const url = await startLogin(db, 'grace@school.example', 'http://app.example/api/auth/sso/callback')
      assert.match(url, /code_challenge_method=S256/)
      const { state, code } = signInAtProvider(url, 'grace@school.example')
      const { userId, workspaceId } = await completeLogin(db, state, code)
      assert.equal(workspaceId, owner.workspaceId)
      assert.deepEqual((await workspacesOf(db, userId)).map((w) => w.role).sort(), ['member', 'owner'])
      await assert.rejects(completeLogin(db, state, code), /expired/)

      // Enforced: no passwords for the domain.
      await assert.rejects(signIn(db, 'owner@school.example', 'owner password'), /single sign-on/)
    })

    test('an identity from another domain is refused', async () => {
      await setManualPlan(db, owner.workspaceId, 'teams', 3, inAYear())
      await markVerified(db, owner.userId)
      await saveConnection(db, owner, { domain: 'school.example', issuer, clientId: 'client-1', clientSecret: 'shh', enforced: false })
      const url = await startLogin(db, 'grace@school.example', 'http://app.example/cb')
      const { state, code } = signInAtProvider(url, 'mallory@evil.example')
      await assert.rejects(completeLogin(db, state, code), /Sign in with your school.example account/)
    })
  })
})

describe('premium voices and languages', () => {
  test('a premium voice is recorded through the speech API as a 24 kHz clip', async () => {
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'speech-'))
    let request: Record<string, unknown> = {}
    const api = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      request = { ...JSON.parse(body), auth: req.headers.authorization, path: req.url }
      res.writeHead(200, { 'content-type': 'audio/pcm' }).end(Buffer.alloc(24_000 * 2 * 1.5)) // 1.5 s of silence
    })
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve))
    process.env.PREMIUM_TTS_API_KEY = 'sk-test'
    process.env.PREMIUM_TTS_BASE_URL = `http://127.0.0.1:${(api.address() as { port: number }).port}/v1`
    try {
      assert.ok(voices().some((v) => v.id === 'premium:coral' && v.premium))
      const clip = await speak('Bonjour à tous.', 'premium:coral')
      assert.equal(clip.seconds, 1.5)
      assert.deepEqual(
        { path: request.path, auth: request.auth, voice: request.voice, format: request.response_format, input: request.input },
        { path: '/v1/audio/speech', auth: 'Bearer sk-test', voice: 'coral', format: 'pcm', input: 'Bonjour à tous.' },
      )
    } finally {
      api.close()
      delete process.env.PREMIUM_TTS_API_KEY
      delete process.env.PREMIUM_TTS_BASE_URL
    }
    assert.ok(!voices().some((v) => v.premium), 'premium voices are offered only when set up')
  })

  test('a lesson in another language asks the model to write in it', () => {
    const [message] = inLanguage([{ role: 'user', content: 'Explain photosynthesis' }], 'French')
    assert.match(message.content, /in French\. Keep ids and JSON keys in English\.$/)
    assert.deepEqual(inLanguage([{ role: 'user', content: 'x' }], 'English'), [{ role: 'user', content: 'x' }])
  })
})

describe('exports', () => {
  test('sampling the Theatre state gives the keyframe values at their times', () => {
    const output = chapter()
    const resolved = compile(output.scene)
    for (const key of resolved.keys.filter((k) => k.prop === 'opacity').slice(0, 6)) {
      const value = sampleAt(resolved, toTheatreState(resolved), Math.round(key.t * 30) / 30).get(key.el)!.opacity
      assert.ok(Math.abs(value - (key.v as number)) < 0.02, `${key.el} at ${key.t}: ${value} vs ${key.v}`)
    }
    const end = sampleAt(resolved, output.theatreState, resolved.duration)
    assert.equal(end.get('a')!.color, rgbaToCss(hexToRgba(PALETTE.blue)))
    assert.ok(output.theatreState.sheetsById[SHEET])
  })

  test('the ZIP writer makes archives that unzip reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zip-'))
    const file = join(dir, 'test.zip')
    await writeFile(file, zip([{ name: 'a.txt', data: Buffer.from('hello '.repeat(100)) }, { name: 'dir/b.bin', data: Buffer.from([1, 2, 3]) }]))
    const listing = execFileSync('unzip', ['-t', file]).toString()
    assert.match(listing, /No errors detected/)
    assert.equal(execFileSync('unzip', ['-p', file, 'a.txt']).toString(), 'hello '.repeat(100))
  })

  test('a lesson becomes an MP4 with video and sound', { timeout: 120_000 }, async () => {
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'video-'))
    const output = chapter()
    const file = join(process.env.DATA_DIR, 'lesson.mp4')
    await exportVideo({ chapters: [{ scene: output.scene, theatreState: output.theatreState }], brand: null, captions: true, output: file, onProgress: () => {} })
    assert.ok((await readFile(file)).length > 10_000)
    // `ffmpeg -i` with no output describes the file on stderr (and exits with an error).
    const { stderr } = spawnSync((await import('@ffmpeg-installer/ffmpeg')).default.path, ['-hide_banner', '-i', file])
    assert.match(stderr.toString(), /Video: h264.*1280x720/)
    assert.match(stderr.toString(), /Audio: aac/)
  })

  test('a SCORM package has its manifest, player, lesson and fonts', { timeout: 180_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scorm-'))
    const file = join(dir, 'lesson.zip')
    const project: Project = { id: 'p1', name: 'How models read', createdAt: '', updatedAt: '', outputs: [chapter()] }
    await exportScorm({ project, brand: null, workspaceId: 'w', assetPath: (u) => u, output: file, onProgress: () => {} })
    const names = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n').sort()
    assert.deepEqual(names, ['fonts/inter.woff2', 'imsmanifest.xml', 'index.html', 'lesson.js', 'player.js'])
    const manifest = execFileSync('unzip', ['-p', file, 'imsmanifest.xml']).toString()
    assert.match(manifest, /adlcp:scormtype="sco" href="index.html"/)
    assert.match(manifest, /<schemaversion>1\.2<\/schemaversion>/)
    assert.ok(!execFileSync('unzip', ['-p', file, 'lesson.js']).toString().includes('secret prompt'))
  })
})
