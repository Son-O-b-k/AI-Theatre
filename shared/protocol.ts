// The contract between the browser and the API server.

export type ProviderKind = 'openai' | 'anthropic' | 'ollama'

export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  models: string[]
  /** Set when the model list could not be fetched (provider offline, missing key, ...). */
  error?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  provider: string
  model: string
  system: string
  messages: ChatMessage[]
}

/** `POST /api/chat` answers with one of these per line (NDJSON). */
export type StreamEvent =
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  outputCount: number
}

/** A narration voice the server can speak with (`GET /api/speech/voices`). */
export interface VoiceInfo {
  id: string
  label: string
}

/** `POST /api/speech` takes `{ text, voice }` and answers with the recorded clip. */
export interface SpeechClip {
  url: string
  seconds: number
}
