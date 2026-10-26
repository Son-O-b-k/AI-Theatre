import type { ProviderConfig } from '../config'
import { readSse, request, trimSlash } from './http'
import type { Provider } from './types'

const DEFAULT_BASE_URL = {
  openai: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
}

/** Any server speaking the OpenAI chat completions API: OpenAI, Ollama, OpenRouter, LM Studio, vLLM, ... */
export function openAiCompatible(config: ProviderConfig & { kind: 'openai' | 'ollama' }): Provider {
  const baseUrl = trimSlash(config.baseUrl ?? DEFAULT_BASE_URL[config.kind])
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`

  return {
    id: config.id,
    label: config.label ?? config.id,
    kind: config.kind,

    async listModels() {
      const response = await request(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(5000) })
      const body = (await response.json()) as { data: { id: string }[] }
      return body.data.map((model) => model.id).sort()
    },

    async *stream({ model, system, messages }, signal) {
      const response = await request(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model,
          stream: true,
          max_tokens: config.maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      })

      for await (const { data } of readSse(response)) {
        if (data === '[DONE]') return
        const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const text = chunk.choices?.[0]?.delta?.content
        if (text) yield text
      }
    },
  }
}
