// Lessons are written on the server (server/lessons/jobs.ts); this hook starts a job, shows its
// progress, and adds each finished chapter to the project. The app is the only writer of its
// projects, so a chapter is confirmed to the server ("claimed") once it has been saved here.
// Chapters finished while the app was closed are collected when their project is opened.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Delivery, JobEvent, JobMode, ModelTarget } from '../../shared/protocol'
import { api } from '../api'
import { record, unrecorded, withNarration } from '../narration'
import { retimed, titleFrom, type Output, type Project } from '../project'
import type { Scene } from '../scene/schema'

export type Mode = JobMode

interface Options {
  target: ModelTarget
  /** Narration voice for new chapters. */
  voice: string
  project: Project | null
  output: Output | null
  create(name: string): Promise<Project>
  update(change: (project: Project) => Project): void
  /** Saves pending project changes now. */
  save(): Promise<void>
  select(outputId: string): void
  onError(error: unknown): void
}

/** Adds a delivered chapter, or replaces the chapter it revises. */
const applyOutput = (output: Output) => (project: Project) => ({
  ...project,
  outputs: project.outputs.some((o) => o.id === output.id)
    ? project.outputs.map((o) => (o.id === output.id ? output : o))
    : [...project.outputs, output],
})

/** Applies recorded clips to the newest copy of a chapter, in case it was edited while recording. */
const narrateOutput = (id: string, voice: string, clips: Awaited<ReturnType<typeof record>>) => (project: Project) => ({
  ...project,
  outputs: project.outputs.map((o) => (o.id === id ? retimed(o, withNarration(o.scene, voice, clips)) : o)),
})

export function useGenerator({ target, voice, project, output, create, update, save, select, onError }: Options) {
  const [live, setLive] = useState<Scene | null>(null)
  const [status, setStatus] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  /** Chapter titles of the lesson being written, and which one is being written. */
  const [plan, setPlan] = useState<{ titles: string[]; index: number } | null>(null)
  const following = useRef<{ jobId: string; source: EventSource } | null>(null)
  const recording = useRef<AbortController | null>(null)
  /** Deliveries already added, so a reconnect's replay does not add them twice. */
  const received = useRef(new Set<string>())
  const projectId = useRef<string | null>(null)
  projectId.current = project?.id ?? null
  /** Set while run() starts a job, so opening its new project does not follow it a second time. */
  const starting = useRef(false)

  /** Adds delivered chapters to the open project (if they belong to it), saves, then claims them. */
  const receive = useCallback(
    async (forProject: string, deliveries: Delivery[]) => {
      const fresh = deliveries.filter((d) => !received.current.has(d.id))
      if (fresh.length === 0 || projectId.current !== forProject) return
      for (const delivery of fresh) {
        received.current.add(delivery.id)
        update(applyOutput(delivery.output as Output))
      }
      await save()
      await api.claimDeliveries(fresh.map((d) => d.id))
    },
    [update, save],
  )

  /** Follows a job until it ends; resolves with the ids of the chapters it delivered. */
  const follow = useCallback(
    (jobId: string, forProject: string) =>
      new Promise<string[]>((resolve) => {
        const delivered: string[] = []
        setStatus('Starting…')
        const source = api.jobEvents(jobId, (event: JobEvent) => {
          if (event.type === 'status') setStatus(event.text)
          else if (event.type === 'plan') setPlan({ titles: event.titles, index: event.index })
          else if (event.type === 'live') setLive(event.scene as Scene)
          else if (event.type === 'warning') setWarnings((current) => (current.includes(event.message) ? current : [...current, event.message]))
          else if (event.type === 'output') {
            delivered.push((event.delivery.output as Output).id)
            receive(forProject, [event.delivery]).catch(onError)
          } else {
            source.close()
            following.current = null
            setLive(null)
            setPlan(null)
            setStatus('')
            if (event.status === 'failed') onError(new Error(event.error ?? 'Writing the lesson failed.'))
            resolve(delivered)
          }
        })
        following.current = { jobId, source }
      }),
    [receive, onError],
  )

  const run = useCallback(
    async (mode: Mode, prompt: string, language: string) => {
      setWarnings([])
      starting.current = true
      try {
        let forProject = project?.id
        if (mode === 'teach' || !project) {
          forProject = (await create(titleFrom(prompt))).id
          update((created) => ({ ...created, language }))
        }
        const request = { mode, prompt, projectId: forProject!, ...target, voice, language, output: mode === 'refine' ? output : undefined }
        const { id } = await api.startJob(request)
        const job = follow(id, forProject!)
        starting.current = false
        const delivered = await job
        if (mode !== 'refine' && delivered[0]) select(delivered[0])
      } catch (error) {
        setStatus('')
        onError(error)
      } finally {
        starting.current = false
      }
    },
    [target, voice, project, output, create, update, follow, select, onError],
  )

  // On opening a project: collect chapters finished while away, and rejoin a job still writing it.
  const openId = project?.id
  useEffect(() => {
    if (!openId) return
    api
      .deliveries(openId)
      .then((deliveries) => receive(openId, deliveries))
      .then(() => api.activeJob())
      .then((active) => {
        if (active?.projectId === openId && !following.current && !starting.current) return follow(active.id, openId)
      })
      .catch(onError)
  }, [openId, receive, follow, onError])

  useEffect(() => () => following.current?.source.close(), [])

  /** Records the narration of chapters in `voice` (or switches them to the browser voice). */
  const narrate = useCallback(
    async (chapters: Output[], voice: string) => {
      const abort = new AbortController()
      recording.current = abort
      setWarnings([])
      try {
        for (const [index, chapter] of chapters.entries()) {
          const lines = unrecorded(chapter.scene, voice)
          const label = chapters.length > 1 ? `Recording chapter ${index + 1}/${chapters.length}` : 'Recording'
          setStatus(`${label}…`)
          const speak = (line: string) => api.speak(line, voice, abort.signal)
          const clips = await record(lines, speak, abort.signal, (i) => setStatus(`${label}: line ${i + 1}/${lines.length}`))
          update(narrateOutput(chapter.id, voice, clips))
        }
      } catch (error) {
        if (!abort.signal.aborted) onError(error)
      } finally {
        recording.current = null
        setStatus('')
      }
    },
    [update, onError],
  )

  const stop = useCallback(() => {
    recording.current?.abort()
    const job = following.current
    if (job) api.cancelJob(job.jobId).catch(onError)
  }, [onError])

  return { run, narrate, stop, live, plan, status, warnings, busy: status !== '' }
}
