// Run with `npm test`. Lesson jobs with a scripted model: delivery, claiming, metering and limits.

import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { LESSON_TOKENS } from '../../shared/plans'
import type { JobEvent, JobRequest } from '../../shared/protocol'
import { PLAN_SYSTEM } from '../../src/ai/prompts'
import type { Output } from '../../src/project'
import { signUp, type Account } from '../accounts'
import { DevBillingProvider } from '../billing/providers/dev'
import { Billing } from '../billing/service'
import type { Db } from '../db'
import type { Provider } from '../providers/types'
import { freshDb } from '../test-db'
import { JobError, Jobs } from './jobs'

const CHAPTERS = [
  { op: 'chapter', title: 'Tokens', goal: 'Words become tokens' },
  { op: 'chapter', title: 'Attention', goal: 'Tokens look at each other' },
]
const SCENE = [
  { op: 'board', title: 'Words become tokens', layout: 'row' },
  { op: 'el', id: 'a', kind: 'box', label: 'The' },
  { op: 'el', id: 'b', kind: 'box', label: 'cat' },
  { op: 'beat', say: 'A model reads text as tokens.', do: [{ show: ['a', 'b'] }] },
]

/** A model that answers instantly; `gate` lets a test hold it mid-answer. */
function scriptedProvider(gate?: Promise<void>): Provider {
  return {
    id: 'scripted',
    label: 'Scripted',
    kind: 'openai',
    listModels: async () => ['m'],
    async *stream(request, signal) {
      await gate
      signal.throwIfAborted()
      const lines = request.system === PLAN_SYSTEM ? CHAPTERS : SCENE
      for (const line of lines) yield JSON.stringify(line) + '\n'
    },
  }
}

const request = (mode: JobRequest['mode'], extra: Partial<JobRequest> = {}): JobRequest => ({
  mode,
  prompt: 'How do language models read?',
  projectId: 'p1',
  provider: 'scripted',
  model: 'm',
  voice: 'browser',
  ...extra,
})

describe('lesson jobs', () => {
  let db: Db
  let billing: Billing
  let account: Account

  beforeEach(async () => {
    db = await freshDb()
    billing = new Billing(db, new DevBillingProvider())
    account = await signUp(db, 'ada@example.com', 'long enough pw')
  })

  afterEach(() => db.close())

  const jobsWith = (provider: Provider) => new Jobs(db, billing, new Map([['scripted', provider]]))

  /** Collects a job's events until it ends. */
  const finish = (jobs: Jobs, id: string) =>
    new Promise<JobEvent[]>((resolve) => {
      const events: JobEvent[] = []
      jobs.subscribe(id, account.workspaceId, (event) => {
        events.push(event)
        if (event.type === 'end') resolve(events)
      })
    })

  test('a lesson is planned, written chapter by chapter, metered and delivered until claimed', async () => {
    const jobs = jobsWith(scriptedProvider())
    const events = await finish(jobs, await jobs.start(account, request('teach')))

    assert.deepEqual(events.at(-1), { type: 'end', status: 'done', error: undefined })
    const outputs = events.flatMap((e) => (e.type === 'output' ? [e.delivery.output as Output] : []))
    assert.deepEqual(outputs.map((o) => o.title), ['Tokens', 'Attention'])
    assert.ok(outputs.every((o) => o.scene.cues.length === 1))
    assert.ok((await billing.entitlements(account.workspaceId)).tokensUsed > 0)

    const waiting = await jobs.unclaimed(account.workspaceId, 'p1')
    assert.equal(waiting.length, 2)
    await jobs.claim(account.workspaceId, [waiting[0].id])
    assert.deepEqual((await jobs.unclaimed(account.workspaceId, 'p1')).map((d) => d.id), [waiting[1].id])
  })

  test('a revision replaces the chapter it was asked to change', async () => {
    const jobs = jobsWith(scriptedProvider())
    const first = (await finish(jobs, await jobs.start(account, request('scene')))).find((e) => e.type === 'output')
    const original = (first as Extract<JobEvent, { type: 'output' }>).delivery.output as Output
    const events = await finish(jobs, await jobs.start(account, request('refine', { prompt: 'slower', output: original })))
    const revised = (events.find((e) => e.type === 'output') as Extract<JobEvent, { type: 'output' }>).delivery.output as Output
    assert.equal(revised.id, original.id)
    assert.equal(revised.revision, original.revision + 1)
  })

  test('a job needs enough allowance to start, and one runs at a time', async () => {
    let release!: () => void
    const jobs = jobsWith(scriptedProvider(new Promise((resolve) => (release = resolve))))
    const id = await jobs.start(account, request('scene'))
    await assert.rejects(jobs.start(account, request('scene')), (e: JobError) => e.status === 409)
    release()
    await finish(jobs, id)

    await billing.recordUsage(account.workspaceId, 'chat', 2.5 * LESSON_TOKENS) // Free: 3 lessons
    await assert.rejects(jobs.start(account, request('teach')), (e: JobError) => e.status === 402 && /needs about 1 lesson/.test(e.message))
    await finish(jobs, await jobs.start(account, request('scene'))) // a quarter lesson still fits
  })

  test('a lesson stops between chapters once the allowance is used up', async () => {
    await billing.recordUsage(account.workspaceId, 'chat', 2 * LESSON_TOKENS)
    const jobs = jobsWith({
      ...scriptedProvider(),
      // Each answer costs most of a lesson.
      async *stream(r) {
        for await (const text of scriptedProvider().stream(r, new AbortController().signal)) yield text
        yield ' '.repeat(LESSON_TOKENS * 4)
      },
    })
    const events = await finish(jobs, await jobs.start(account, request('teach')))
    assert.equal(events.filter((e) => e.type === 'output').length, 1)
    assert.ok(events.some((e) => e.type === 'warning' && /allowance is used up/.test(e.message)))
  })

  test('stopping a job ends it as cancelled', async () => {
    let release!: () => void
    const jobs = jobsWith(scriptedProvider(new Promise((resolve) => (release = resolve))))
    const id = await jobs.start(account, request('teach'))
    const ended = finish(jobs, id)
    jobs.cancel(id, account.workspaceId)
    release()
    assert.deepEqual((await ended).at(-1), { type: 'end', status: 'cancelled', error: undefined })
  })

  test('jobs cut short by a restart are marked failed', async () => {
    await db.run("INSERT INTO jobs (id, workspace_id, project_id, mode, prompt, status, created_at) VALUES ('j1', ?, 'p1', 'teach', 'x', 'running', 'now')", account.workspaceId)
    await jobsWith(scriptedProvider()).recover()
    assert.deepEqual({ ...(await db.get<{ status: string; error: string }>('SELECT status, error FROM jobs WHERE id = ?', 'j1')) }, { status: 'failed', error: 'The server restarted.' })
  })
})
