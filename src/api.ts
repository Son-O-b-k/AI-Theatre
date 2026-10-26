import { readLines } from '../shared/lines'
import type { ChatRequest, ProjectSummary, ProviderInfo, SpeechClip, StreamEvent, VoiceInfo } from '../shared/protocol'
import type { Project } from './project'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(typeof body.error === 'string' ? body.error : `${response.status} ${response.statusText}`)
  }
  return (response.status === 204 ? undefined : await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  providers: () => call<ProviderInfo[]>('/api/providers'),
  projects: () => call<ProjectSummary[]>('/api/projects'),
  project: (id: string) => call<Project>(`/api/projects/${id}`),
  saveProject: (project: Project) => call<void>(`/api/projects/${project.id}`, json('PUT', project)),
  deleteProject: (id: string) => call<void>(`/api/projects/${id}`, { method: 'DELETE' }),

  uploadAsset: (projectId: string, file: File) => {
    const name = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
    return call<{ url: string }>(`/api/projects/${projectId}/assets/${name}`, { method: 'PUT', body: file })
  },

  voices: () => call<VoiceInfo[]>('/api/speech/voices'),
  speak: (text: string, voice: string, signal?: AbortSignal) =>
    call<SpeechClip>('/api/speech', { ...json('POST', { text, voice }), signal }),

  /** Streams the model's text as it is generated. */
  async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<string> {
    const response = await fetch('/api/chat', { ...json('POST', request), signal })
    if (!response.ok || !response.body) throw new Error(`Chat failed: ${response.status} ${await response.text()}`)

    for await (const line of readLines(response.body)) {
      if (!line) continue
      const event = JSON.parse(line) as StreamEvent
      if (event.type === 'error') throw new Error(event.message)
      if (event.type === 'done') return
      yield event.text
    }
  },
}
