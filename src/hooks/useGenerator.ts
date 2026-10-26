import { useCallback, useRef, useState } from 'react'
import { generateScene, planLesson, type ModelTarget } from '../ai/generate'
import { chapterMessages, refineMessages, sceneMessages } from '../ai/prompts'
import { record, unrecorded, withNarration } from '../narration'
import { newOutput, retimed, reviseOutput, type Output, type Project, type Turn } from '../project'
import type { Scene } from '../scene/schema'

export type Mode = 'teach' | 'scene' | 'refine'

interface Options {
  target: ModelTarget
  /** Narration voice for new chapters. */
  voice: string
  project: Project | null
  output: Output | null
  create(name: string): Promise<Project>
  update(change: (project: Project) => Project): void
  select(outputId: string): void
  onError(error: unknown): void
}

const titleFrom = (prompt: string) => (prompt.length > 48 ? `${prompt.slice(0, 45)}…` : prompt)

const addOutput = (output: Output) => (project: Project) => ({ ...project, outputs: [...project.outputs, output] })

const replaceOutput = (output: Output) => (project: Project) => ({
  ...project,
  outputs: project.outputs.map((o) => (o.id === output.id ? output : o)),
})

/** Applies recorded clips to the newest copy of a chapter, in case it was edited while recording. */
const narrateOutput = (id: string, voice: string, clips: Awaited<ReturnType<typeof record>>) => (project: Project) => ({
  ...project,
  outputs: project.outputs.map((o) => (o.id === id ? retimed(o, withNarration(o.scene, voice, clips)) : o)),
})

export function useGenerator({ target, voice, project, output, create, update, select, onError }: Options) {
  const [live, setLive] = useState<Scene | null>(null)
  const [status, setStatus] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  /** Chapter titles of the lesson being generated, and which one is being written. */
  const [plan, setPlan] = useState<{ titles: string[]; index: number } | null>(null)
  const controller = useRef<AbortController | null>(null)

  const run = useCallback(
    async (mode: Mode, prompt: string) => {
      const abort = new AbortController()
      controller.current = abort
      setWarnings([])
      setStatus('Starting…')

      const turn: Turn = { prompt, ...target, at: new Date().toISOString() }
      const scene = async (label: string, messages: Parameters<typeof generateScene>[1]) => {
        setStatus(`${label}: waiting for the model…`)
        const result = await generateScene(target, messages, abort.signal, (partial) => {
          setLive(partial)
          setStatus(`${label}: ${partial.boards.length} boards, ${partial.elements.length} shapes, ${partial.beats.length} beats`)
        })
        setWarnings((current) => [...current, ...result.warnings])
        return narrated(label, result.scene)
      }

      /** Records the narration; without it the browser reads the lines, so a failure is only a warning. */
      const narrated = async (label: string, written: Scene) => {
        const lines = unrecorded(written, voice)
        if (lines.length === 0) return withNarration(written, voice)
        try {
          const clips = await record(lines, voice, abort.signal, (index) =>
            setStatus(`${label}: recording narration ${index + 1}/${lines.length}`),
          )
          return withNarration(written, voice, clips)
        } catch (error) {
          if (abort.signal.aborted) throw error
          setWarnings((current) => [...current, `narration not recorded (${errorMessage(error)}); the browser voice reads it instead`])
          return written
        }
      }

      try {
        if (mode === 'refine') {
          if (!output) throw new Error('Select an output to refine.')
          update(replaceOutput(reviseOutput(output, await scene('Revising', refineMessages(output.scene, prompt)), turn)))
        } else if (mode === 'scene') {
          if (!project) await create(titleFrom(prompt))
          const next = newOutput(titleFrom(prompt), await scene('Writing scene', sceneMessages(prompt)), turn)
          update(addOutput(next))
          select(next.id)
        } else {
          await create(titleFrom(prompt))
          setStatus('Planning the lesson…')
          const outline = await planLesson(target, prompt, abort.signal)
          const titles = outline.map((chapter) => chapter.title)
          let first: string | null = null
          for (const [index, chapter] of outline.entries()) {
            setPlan({ titles, index })
            const label = `Chapter ${index + 1}/${outline.length} · ${chapter.title}`
            const next = newOutput(
              chapter.title,
              await scene(label, chapterMessages(prompt, outline, index)),
              { ...turn, prompt: `${prompt}: ${chapter.title}` },
            )
            update(addOutput(next))
            first ??= next.id
          }
          if (first) select(first)
        }
      } catch (error) {
        if (!abort.signal.aborted) onError(error)
      } finally {
        controller.current = null
        setLive(null)
        setPlan(null)
        setStatus('')
      }
    },
    [target, voice, project, output, create, update, select, onError],
  )

  /** Records the narration of chapters in `voice` (or switches them to the browser voice). */
  const narrate = useCallback(
    async (chapters: Output[], voice: string) => {
      const abort = new AbortController()
      controller.current = abort
      setWarnings([])
      try {
        for (const [index, chapter] of chapters.entries()) {
          const lines = unrecorded(chapter.scene, voice)
          const label = chapters.length > 1 ? `Recording chapter ${index + 1}/${chapters.length}` : 'Recording'
          setStatus(`${label}…`)
          const clips = await record(lines, voice, abort.signal, (index) => setStatus(`${label}: line ${index + 1}/${lines.length}`))
          update(narrateOutput(chapter.id, voice, clips))
        }
      } catch (error) {
        if (!abort.signal.aborted) onError(error)
      } finally {
        controller.current = null
        setStatus('')
      }
    },
    [update, onError],
  )

  const stop = useCallback(() => controller.current?.abort(), [])

  return { run, narrate, stop, live, plan, status, warnings, busy: status !== '' }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
