import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import type { ChatMessage } from '../../shared/protocol'
import { api } from '../api'
import { applyOp, emptyScene, finalizeScene } from '../scene/scene'
import { describeError, parseOp, type Scene } from '../scene/schema'
import { PLAN_SYSTEM, SCENE_SYSTEM, planMessages, type Chapter } from './prompts'

export interface ModelTarget {
  provider: string
  model: string
}

type Line = { ok: true; value: unknown } | { ok: false; line: string; error: string }

/** Turns streamed text into parsed JSON lines as soon as each line is complete. */
async function* jsonLines(chunks: AsyncIterable<string>): AsyncGenerator<Line> {
  let buffer = ''
  const parse = (raw: string): Line | null => {
    const line = raw.trim()
    if (!line || line.startsWith('```')) return null
    try {
      return { ok: true, value: JSON.parse(line) }
    } catch {
      // Models often slip on JSON syntax (trailing commas, unquoted keys, a missing brace).
      try {
        return { ok: true, value: JSON.parse(jsonrepair(line)) }
      } catch {
        return { ok: false, line, error: 'not valid JSON' }
      }
    }
  }

  for await (const chunk of chunks) {
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const result = parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      if (result) yield result
    }
  }
  const last = parse(buffer)
  if (last) yield last
}

function stream(target: ModelTarget, system: string, messages: ChatMessage[], signal: AbortSignal) {
  return jsonLines(api.chat({ ...target, system, messages }, signal))
}

export interface SceneResult {
  scene: Scene
  /** Parts of the model's answer that could not be used. */
  warnings: string[]
}

/** Streams a scene, reporting every intermediate state so the stage can render it live. */
export async function generateScene(
  target: ModelTarget,
  messages: ChatMessage[],
  signal: AbortSignal,
  onProgress: (scene: Scene) => void,
): Promise<SceneResult> {
  let scene = emptyScene()
  const warnings: string[] = []
  const warn = (message: string) => warnings.push(message)

  for await (const line of stream(target, SCENE_SYSTEM, messages, signal)) {
    if (!line.ok) {
      warn(`${line.error}: ${line.line.slice(0, 80)}`)
      continue
    }
    try {
      scene = applyOp(scene, parseOp(line.value), warn)
      onProgress(scene)
    } catch (error) {
      warn(describeError(error))
    }
  }

  if (scene.elements.length === 0) throw new Error('The model did not produce any elements.')
  return { scene: finalizeScene(scene, warn), warnings }
}

const ChapterSchema = z.object({ op: z.literal('chapter'), title: z.string().min(1), goal: z.string().min(1) })

export async function planLesson(target: ModelTarget, topic: string, signal: AbortSignal): Promise<Chapter[]> {
  const chapters: Chapter[] = []
  for await (const line of stream(target, PLAN_SYSTEM, planMessages(topic), signal)) {
    const parsed = line.ok ? ChapterSchema.safeParse(line.value) : null
    if (parsed?.success) chapters.push({ title: parsed.data.title, goal: parsed.data.goal })
  }
  if (chapters.length === 0) throw new Error('The model did not produce a lesson outline.')
  return chapters
}
