// Lesson generation runs here, on the server, as jobs: it keeps going if the browser is closed,
// and every model call is metered against the workspace's allowance as it happens.
//
// The app stays the only writer of its projects. Each finished chapter is stored as a delivery
// (job_outputs) and streamed to the app, which adds it to the project and then claims it;
// deliveries not yet claimed (tab closed, connection lost) are handed over next time.

import { LESSON_TOKENS } from '../../shared/plans'
import type { ChatMessage, Delivery, JobEvent, JobMode, JobRequest } from '../../shared/protocol'
import { generateScene, planLesson, type Complete } from '../../src/ai/generate'
import { DEFAULT_LANGUAGE } from '../../shared/languages'
import { chapterMessages, inLanguage, planMessages, refineMessages, sceneMessages } from '../../src/ai/prompts'
import { record, unrecorded, withNarration } from '../../src/narration'
import { newOutput, reviseOutput, titleFrom, type Output, type Turn } from '../../src/project'
import type { Scene } from '../../src/scene/schema'
import type { Account } from '../accounts'
import type { Billing } from '../billing/service'
import { newId, now, type Db } from '../db'
import type { Provider } from '../providers/types'
import * as speech from '../speech'
import { planFor } from '../features'
import { isWorkspaceProvider, workspaceProvider } from '../workspace-providers'
import { OWN_KEY_USAGE } from '../billing/repo'

export class JobError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 404 | 409 = 400) {
    super(message)
  }
}

/** Allowance a job needs before it may start, in lessons: a whole lesson, or a chapter's worth. */
const NEEDS: Record<JobMode, number> = { teach: 1, scene: 0.25, refine: 0.25 }
/** Finished jobs stay in memory this long, for an app that reconnects. */
const KEEP_FINISHED_MS = 10 * 60_000
/** At most this many live previews a second, per job. */
const LIVE_INTERVAL_MS = 150

/** Providers count tokens differently; about four characters per token is close enough to meter by. */
const estimateTokens = (characters: number) => Math.ceil(characters / 4)

type Listener = (event: JobEvent) => void

class Job {
  readonly abort = new AbortController()
  readonly listeners = new Set<Listener>()
  status: JobEvent | null = null
  plan: JobEvent | null = null
  live: JobEvent | null = null
  readonly warnings: JobEvent[] = []
  readonly outputs: JobEvent[] = []
  end: JobEvent | null = null
  private lastLive = 0

  constructor(
    readonly id: string,
    readonly workspaceId: string,
    readonly projectId: string,
  ) {}

  emit(event: JobEvent): void {
    if (event.type === 'live') {
      if (Date.now() - this.lastLive < LIVE_INTERVAL_MS) return
      this.lastLive = Date.now()
      this.live = event
    } else if (event.type === 'status') this.status = event
    else if (event.type === 'plan') this.plan = event
    else if (event.type === 'warning') this.warnings.push(event)
    else if (event.type === 'output') this.outputs.push(event)
    else this.end = event
    for (const listener of this.listeners) listener(event)
  }

  /** Everything a new listener needs to catch up, in order. */
  snapshot(): JobEvent[] {
    return [this.status, this.plan, ...this.warnings, ...this.outputs, this.live, this.end].filter((e): e is JobEvent => e !== null)
  }
}

export class Jobs {
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly db: Db,
    private readonly billing: Billing,
    private readonly providers: Map<string, Provider>,
  ) {}

  /** Jobs cut short by a restart are marked failed; their finished chapters can still be claimed. */
  async recover(): Promise<void> {
    await this.db.run("UPDATE jobs SET status = 'failed', error = 'The server restarted.', finished_at = ? WHERE status = 'running'", now())
  }

  async start(account: Account, request: JobRequest): Promise<string> {
    const { workspaceId } = account
    if ([...this.jobs.values()].some((job) => job.workspaceId === workspaceId && !job.end)) {
      throw new JobError('This workspace is already writing a lesson. Wait for it to finish or stop it.', 409)
    }
    if (request.mode === 'refine' && !request.output) throw new JobError('Choose the chapter to change.')
    const allowance = await this.billing.entitlements(workspaceId)

    // The workspace's own provider (Teams) is paid for by the workspace, so it skips the allowance.
    const own = isWorkspaceProvider(request.provider)
    if (own && !allowance.features.includes('ownProviders')) {
      throw new JobError(`Your own AI provider is part of the ${planFor('ownProviders').name} plan.`, 402)
    }
    const provider = own ? await workspaceProvider(this.db, workspaceId, request.provider) : this.providers.get(request.provider)
    if (!provider) throw new JobError(`Unknown provider: ${request.provider}`, 404)

    const left = (allowance.tokenAllowance - allowance.tokensUsed) / LESSON_TOKENS
    if (!own && left < NEEDS[request.mode]) {
      const what = request.mode === 'teach' ? 'A new lesson needs about 1 lesson' : 'This needs about a quarter of a lesson'
      throw new JobError(`${what} of your monthly allowance, and ${Math.max(0, left).toFixed(1)} is left. Upgrade for more.`, 402)
    }

    // Other languages and premium voices are Pro features; other languages need a premium voice.
    const language = request.language ?? DEFAULT_LANGUAGE
    const premium = allowance.features.includes('premiumVoices')
    if (language !== DEFAULT_LANGUAGE && !premium) {
      throw new JobError(`Lessons in other languages are part of the ${planFor('premiumVoices').name} plan. Upgrade to use them.`, 402)
    }
    if (speech.isPremium(request.voice) && !premium) {
      throw new JobError(`Premium voices are part of the ${planFor('premiumVoices').name} plan. Upgrade to use them.`, 402)
    }
    let voice = request.voice
    if (language !== DEFAULT_LANGUAGE && !speech.isPremium(voice)) {
      if (!speech.premiumAvailable()) throw new JobError('Lessons in other languages need premium voices, which are not set up on this server yet.')
      voice = 'premium:coral'
    }

    const job = new Job(newId(), workspaceId, request.projectId)
    await this.db.run(
      "INSERT INTO jobs (id, workspace_id, project_id, mode, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, 'running', ?)",
      job.id, workspaceId, request.projectId, request.mode, request.prompt, now(),
    )
    this.jobs.set(job.id, job)
    // Runs in the background; an error escaping it would crash the server, so it is logged instead.
    this.run(job, provider, { ...request, voice, language }, own).catch((error) => console.error(`Job ${job.id} failed to finish:`, error))
    return job.id
  }

  /** Streams the job's events, starting with what already happened. Returns the unsubscribe. */
  subscribe(jobId: string, workspaceId: string, listener: Listener): () => void {
    const job = this.find(jobId, workspaceId)
    for (const event of job.snapshot()) listener(event)
    job.listeners.add(listener)
    return () => job.listeners.delete(listener)
  }

  cancel(jobId: string, workspaceId: string): void {
    this.find(jobId, workspaceId).abort.abort()
  }

  /** The workspace's running job, for an app that opens while one is under way. */
  active(workspaceId: string): { id: string; projectId: string } | null {
    const job = [...this.jobs.values()].find((j) => j.workspaceId === workspaceId && !j.end)
    return job ? { id: job.id, projectId: job.projectId } : null
  }

  async unclaimed(workspaceId: string, projectId: string): Promise<Delivery[]> {
    const rows = await this.db.all<{ id: string; output: string }>(
      'SELECT id, output FROM job_outputs WHERE workspace_id = ? AND project_id = ? AND claimed_at IS NULL ORDER BY created_at',
      workspaceId,
      projectId,
    )
    return rows.map((row) => ({ id: row.id, output: JSON.parse(row.output) }))
  }

  async claim(workspaceId: string, ids: string[]): Promise<void> {
    for (const id of ids) await this.db.run('UPDATE job_outputs SET claimed_at = ? WHERE id = ? AND workspace_id = ?', now(), id, workspaceId)
  }

  private find(jobId: string, workspaceId: string): Job {
    const job = this.jobs.get(jobId)
    if (!job || job.workspaceId !== workspaceId) throw new JobError('No such job.', 404)
    return job
  }

  private async run(job: Job, provider: Provider, request: JobRequest, own: boolean): Promise<void> {
    const { signal } = job.abort
    const turn: Turn = { prompt: request.prompt, provider: request.provider, model: request.model, at: now() }

    const billing = this.billing
    const complete: Complete = async function* (system, messages, callSignal) {
      let characters = system.length + messages.reduce((sum, m) => sum + m.content.length, 0)
      try {
        for await (const text of provider.stream({ model: request.model, system, messages }, callSignal)) {
          characters += text.length
          yield text
        }
      } finally {
        // Whatever the model produced was paid for, even if the job was stopped.
        await billing.recordUsage(job.workspaceId, own ? OWN_KEY_USAGE : 'chat', estimateTokens(characters))
      }
    }

    const deliver = async (output: Output) => {
      const delivery: Delivery = { id: newId(), output }
      await this.db.run(
        'INSERT INTO job_outputs (id, job_id, workspace_id, project_id, output, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        delivery.id, job.id, job.workspaceId, job.projectId, JSON.stringify(output), now(),
      )
      job.emit({ type: 'output', delivery })
    }

    /** Records the narration; without it the browser reads the lines, so a failure is only a warning. */
    const narrated = async (label: string, written: Scene): Promise<Scene> => {
      const lines = unrecorded(written, request.voice)
      if (lines.length === 0) return withNarration(written, request.voice)
      try {
        const clips = await record(lines, (line) => speech.speak(line, request.voice), signal, (index) =>
          job.emit({ type: 'status', text: `${label}: recording narration ${index + 1}/${lines.length}` }),
        )
        return withNarration(written, request.voice, clips)
      } catch (error) {
        if (signal.aborted) throw error
        job.emit({ type: 'warning', message: `narration not recorded (${message(error)}); the browser voice reads it instead` })
        return written
      }
    }

    const language = request.language ?? DEFAULT_LANGUAGE
    const scene = async (label: string, messages: ChatMessage[]): Promise<Scene> => {
      job.emit({ type: 'status', text: `${label}: waiting for the model…` })
      const result = await generateScene(complete, inLanguage(messages, language), signal, (partial) => {
        job.emit({ type: 'live', scene: partial })
        job.emit({ type: 'status', text: `${label}: ${partial.boards.length} boards, ${partial.elements.length} shapes, ${partial.beats.length} beats` })
      })
      for (const warning of result.warnings) job.emit({ type: 'warning', message: warning })
      return narrated(label, result.scene)
    }

    let status: 'done' | 'failed' | 'cancelled' = 'done'
    let error: string | undefined
    try {
      if (request.mode === 'refine') {
        const output = request.output as Output
        await deliver(reviseOutput(output, await scene('Revising', refineMessages(output.scene, request.prompt)), turn))
      } else if (request.mode === 'scene') {
        await deliver(newOutput(titleFrom(request.prompt), await scene('Writing scene', sceneMessages(request.prompt)), turn))
      } else {
        job.emit({ type: 'status', text: 'Planning the lesson…' })
        const outline = await planLesson(complete, inLanguage(planMessages(request.prompt), language), signal)
        const titles = outline.map((chapter) => chapter.title)
        for (const [index, chapter] of outline.entries()) {
          if (index > 0 && !own && !(await this.billing.entitlements(job.workspaceId)).canGenerate) {
            job.emit({ type: 'warning', message: `stopped after ${index} chapters: this month's allowance is used up` })
            break
          }
          job.emit({ type: 'plan', titles, index })
          const label = `Chapter ${index + 1}/${outline.length} · ${chapter.title}`
          const written = await scene(label, chapterMessages(request.prompt, outline, index))
          await deliver(newOutput(chapter.title, written, { ...turn, prompt: `${request.prompt}: ${chapter.title}` }))
        }
      }
    } catch (caught) {
      status = signal.aborted ? 'cancelled' : 'failed'
      error = signal.aborted ? undefined : message(caught)
    }

    await this.db.run('UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?', status, error ?? null, now(), job.id)
    job.emit({ type: 'end', status, error })
    setTimeout(() => this.jobs.delete(job.id), KEEP_FINISHED_MS).unref()
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
