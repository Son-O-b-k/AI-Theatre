// Lesson generation runs here, on the server, as jobs: it keeps going if the browser is closed,
// and every model call is metered against the workspace's allowance as it happens.
//
// The app stays the only writer of its projects. Each finished chapter is stored as a delivery
// (job_outputs) and streamed to the app, which adds it to the project and then claims it;
// deliveries not yet claimed (tab closed, connection lost) are handed over next time.

import { LESSON_TOKENS } from '../../shared/plans'
import { DEFAULT_PROVIDER_ID, type ChatMessage, type Delivery, type JobEvent, type JobMode, type JobRequest } from '../../shared/protocol'
import { generateScene, planLesson, type Complete } from '../../src/ai/generate'
import type { Chapter } from '../../src/ai/prompts'
import { DEFAULT_LANGUAGE } from '../../shared/languages'
import { chapterMessages, inFormat, inLanguage, planMessages, refineMessages, sceneMessages } from '../../src/ai/prompts'
import { record, unrecorded, withNarration } from '../../src/narration'
import { newOutput, reviseOutput, titleFrom, type Output, type Turn } from '../../src/project'
import type { Scene } from '../../src/scene/schema'
import type { Account } from '../accounts'
import type { Billing } from '../billing/service'
import { newId, now, type Db } from '../db'
import { resolveDefault } from '../providers'
import type { Provider } from '../providers/types'
import { defaultModelFromEnv } from '../config'
import * as speech from '../speech'
import { planFor } from '../features'
import { isWorkspaceProvider, workspaceProvider } from '../workspace-providers'
import { OWN_KEY_USAGE } from '../billing/repo'
import { explainProviderError } from '../providers/errors'

export class JobError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 404 | 409 = 400) {
    super(message)
  }
}

/** Allowance a job needs before it may start, in lessons: a whole lesson, or a chapter's worth. */
const NEEDS: Record<JobMode, number> = { teach: 1, scene: 0.25, refine: 0.25 }
/** Finished jobs stay in memory this long, for an app that reconnects. */
const KEEP_FINISHED_MS = 10 * 60_000
/** A job that was running when the server stopped this many times is not resumed again: it may be the cause. */
const MAX_ATTEMPTS = 3
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

  /**
   * Jobs cut short by a restart (a deploy, a crash) carry on where they stopped: a lesson keeps its
   * plan and the chapters already finished, and writes the rest. A job that cannot be carried on
   * (its key was removed, or it was cut short too often) is marked failed; what it finished can still be claimed.
   */
  async recover(): Promise<void> {
    const rows = await this.db.all<JobRow>("SELECT id, workspace_id, project_id, request, outline, attempts FROM jobs WHERE status = 'running'")
    for (const row of rows) {
      try {
        await this.resume(row)
      } catch (error) {
        const reason = error instanceof JobError ? error.message : 'The server restarted.'
        if (!(error instanceof JobError)) console.error(`Job ${row.id} could not be resumed:`, error)
        await this.db.run("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", reason, now(), row.id)
      }
    }
  }

  private async resume(row: JobRow): Promise<void> {
    if (!row.request || Number(row.attempts) + 1 >= MAX_ATTEMPTS) throw new JobError('The server restarted.')
    const stored = JSON.parse(row.request) as JobRequest
    const own = isWorkspaceProvider(stored.provider)
    const provider = own ? await workspaceProvider(this.db, row.workspace_id, stored.provider).catch(() => undefined) : this.providers.get(stored.provider)
    if (!provider) throw new JobError('The server restarted, and the AI model this lesson was written with is no longer set up.')

    await this.db.run('UPDATE jobs SET attempts = attempts + 1 WHERE id = ?', row.id)
    const job = new Job(row.id, row.workspace_id, row.project_id)
    const finished = await this.db.all<{ id: string; output: string }>('SELECT id, output FROM job_outputs WHERE job_id = ? ORDER BY created_at', row.id)
    // Whoever reconnects sees the chapters already finished, as if nothing had happened.
    for (const { id, output } of finished) job.emit({ type: 'output', delivery: { id, output: JSON.parse(output) } })
    this.jobs.set(job.id, job)
    const outline = row.outline ? (JSON.parse(row.outline) as Chapter[]) : undefined
    this.run(job, provider, stored, own, { outline, done: finished.length }).catch((error) => console.error(`Job ${job.id} failed to finish:`, error))
  }

  async start(account: Account, request: JobRequest): Promise<string> {
    const { workspaceId } = account
    if ([...this.jobs.values()].some((job) => job.workspaceId === workspaceId && !job.end)) {
      throw new JobError('This workspace is already writing a lesson. Wait for it to finish or stop it.', 409)
    }
    if (request.mode === 'refine' && !request.output) throw new JobError('Choose the chapter to change.')
    const allowance = await this.billing.entitlements(workspaceId)

    // The workspace's own key pays for the AI, so it uses the plan's own-key allowance instead of its lessons.
    const own = isWorkspaceProvider(request.provider)
    if (own && !allowance.features.includes('ownProviders')) {
      throw new JobError(`Your own AI provider is part of the ${planFor('ownProviders').name} plan.`, 402)
    }
    let provider: Provider | undefined
    if (own) provider = await workspaceProvider(this.db, workspaceId, request.provider)
    else if (request.provider === DEFAULT_PROVIDER_ID || !request.provider) {
      // No model chosen: the server's default (AI_DEFAULT_PROVIDER / AI_DEFAULT_MODEL), at the standard rate.
      const fallback = await resolveDefault(this.providers, defaultModelFromEnv())
      if (!fallback) throw new JobError('No AI model is set up on the server yet. Add your own key under Workspace → AI models.', 404)
      provider = fallback.provider
      request = { ...request, provider: fallback.provider.id, model: fallback.model }
    }
    // The server's other providers are not offered to people; only through the default.
    if (!provider) throw new JobError('That AI model is not available. Choose AI Theatre or one of your own keys.', 404)
    if (!request.model) throw new JobError('Choose a model first.')

    const allowed = own ? allowance.ownKeyAllowance : allowance.tokenAllowance
    const used = own ? allowance.ownKeyTokensUsed : allowance.tokensUsed
    const left = allowed === null ? Infinity : (allowed - used) / LESSON_TOKENS
    if (left < NEEDS[request.mode]) {
      const what = request.mode === 'teach' ? 'A new lesson needs about 1 lesson' : 'This needs about a quarter of a lesson'
      const of = own ? 'of your monthly lessons with your own key' : 'of your monthly allowance'
      throw new JobError(`${what} ${of}, and ${Math.max(0, left).toFixed(1)} is left. Upgrade for more.`, 402)
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
    const accepted: JobRequest = { ...request, voice, language }
    // Kept so the job can carry on after a restart (recover); the provider's key is not in it.
    await this.db.run(
      "INSERT INTO jobs (id, workspace_id, project_id, mode, prompt, status, created_at, request) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
      job.id, workspaceId, request.projectId, request.mode, request.prompt, now(), JSON.stringify(accepted),
    )
    this.jobs.set(job.id, job)
    // Runs in the background; an error escaping it would crash the server, so it is logged instead.
    this.run(job, provider, accepted, own).catch((error) => console.error(`Job ${job.id} failed to finish:`, error))
    return job.id
  }

  /**
   * Streams the job's events, starting with what already happened. Returns the unsubscribe.
   * A job finished long ago is no longer in memory; it only ends, so an app that was away for a
   * while stops waiting (and collects the chapters with `unclaimed`).
   */
  async subscribe(jobId: string, workspaceId: string, listener: Listener): Promise<() => void> {
    const job = this.jobs.get(jobId)
    if (!job || job.workspaceId !== workspaceId) {
      const row = await this.db.get<{ status: string; error: string | null }>('SELECT status, error FROM jobs WHERE id = ? AND workspace_id = ?', jobId, workspaceId)
      if (!row) throw new JobError('No such job.', 404)
      const status = row.status === 'done' || row.status === 'cancelled' ? row.status : 'failed'
      listener({ type: 'end', status, error: status === 'failed' ? (row.error ?? 'Writing the lesson stopped.') : undefined })
      return () => {}
    }
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

  /** Writes what was asked; `resume` carries on a job a restart cut short (its plan, and how many chapters were finished). */
  private async run(job: Job, provider: Provider, request: JobRequest, own: boolean, resume?: { outline?: Chapter[]; done: number }): Promise<void> {
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
    const { format } = request
    const scene = async (label: string, messages: ChatMessage[]): Promise<Scene> => {
      job.emit({ type: 'status', text: `${label}: waiting for the model…` })
      const result = await generateScene(complete, inFormat(inLanguage(messages, language), format), signal, (partial) => {
        job.emit({ type: 'live', scene: { ...partial, format } })
        job.emit({ type: 'status', text: `${label}: ${partial.boards.length} boards, ${partial.elements.length} shapes, ${partial.beats.length} beats` })
      })
      for (const warning of result.warnings) job.emit({ type: 'warning', message: warning })
      return narrated(label, { ...result.scene, format })
    }

    // Ollama reads only its context window (often a few thousand tokens unless raised) and drops the rest unannounced.
    if (request.source && request.mode !== 'refine' && provider.kind === 'ollama') {
      job.emit({
        type: 'warning',
        message: "Ollama models often read only the first few thousand words of a request; if the lesson misses parts of your source, raise the model's context length (OLLAMA_CONTEXT_LENGTH)",
      })
    }

    if (resume) job.emit({ type: 'warning', message: 'the server restarted while writing; it carried on where it stopped' })

    let status: 'done' | 'failed' | 'cancelled' = 'done'
    let error: string | undefined
    try {
      if (request.mode !== 'teach' && resume && resume.done > 0) {
        // The chapter was finished before the restart; nothing is left to write.
      } else if (request.mode === 'refine') {
        const output = request.output as Output
        await deliver(reviseOutput(output, await scene('Revising', refineMessages(output.scene, request.prompt)), turn))
      } else if (request.mode === 'scene') {
        await deliver(newOutput(titleFrom(request.prompt), await scene('Writing scene', sceneMessages(request.prompt, request.source)), turn))
      } else {
        let outline = resume?.outline
        if (!outline) {
          job.emit({ type: 'status', text: 'Planning the lesson…' })
          outline = await planLesson(complete, inLanguage(planMessages(request.prompt, request.source), language), signal)
          await this.db.run('UPDATE jobs SET outline = ? WHERE id = ?', JSON.stringify(outline), job.id)
        }
        const titles = outline.map((chapter) => chapter.title)
        for (const [index, chapter] of outline.entries()) {
          if (index < (resume?.done ?? 0)) continue
          const left = index > 0 && (await this.billing.entitlements(job.workspaceId))
          if (left && !(own ? left.canGenerateOwnKey : left.canGenerate)) {
            job.emit({ type: 'warning', message: `stopped after ${index} chapters: this month's allowance is used up` })
            break
          }
          job.emit({ type: 'plan', titles, index })
          const label = `Chapter ${index + 1}/${outline.length} · ${chapter.title}`
          const written = await scene(label, chapterMessages(request.prompt, outline, index, request.source))
          await deliver(newOutput(chapter.title, written, { ...turn, prompt: `${request.prompt}: ${chapter.title}` }))
        }
      }
    } catch (caught) {
      status = signal.aborted ? 'cancelled' : 'failed'
      if (!signal.aborted) {
        error = explainProviderError(caught, { label: provider.label, kind: provider.kind, model: request.model, own })
        // The server's own model failing is for whoever runs the server to fix; they see the details here.
        if (error !== message(caught)) console.error(`Job ${job.id} failed: ${message(caught)}`)
      }
    }

    await this.db.run('UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?', status, error ?? null, now(), job.id)
    job.emit({ type: 'end', status, error })
    setTimeout(() => this.jobs.delete(job.id), KEEP_FINISHED_MS).unref()
  }
}

interface JobRow {
  id: string
  workspace_id: string
  project_id: string
  request: string | null
  outline: string | null
  attempts: number
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
