import type { ChatMessage, ProviderKind } from '../../shared/protocol'

export interface CompletionRequest {
  model: string
  system: string
  messages: ChatMessage[]
}

export interface Provider {
  readonly id: string
  readonly label: string
  readonly kind: ProviderKind
  listModels(): Promise<string[]>
  /** Yields text deltas as the model produces them. */
  stream(request: CompletionRequest, signal: AbortSignal): AsyncGenerator<string>
}
