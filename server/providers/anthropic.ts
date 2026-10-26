import type { ProviderConfig } from '../config'
import { readSse, request, trimSlash } from './http'
import type { Provider } from './types'

const API_VERSION = '2023-06-01'

export function anthropic(config: ProviderConfig): Provider {
  const baseUrl = trimSlash(config.baseUrl ?? 'https://api.anthropic.com')
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': API_VERSION,
    'x-api-key': config.apiKey ?? '',
  }

  return {
    id: config.id,
    label: config.label ?? config.id,
    kind: 'anthropic',

    async listModels() {
      const response = await request(`${baseUrl}/v1/models?limit=100`, { headers, signal: AbortSignal.timeout(5000) })
      const body = (await response.json()) as { data: { id: string }[] }
      return body.data.map((model) => model.id)
    },

    async *stream({ model, system, messages }, signal) {
      const response = await request(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({ model, system, messages, stream: true, max_tokens: config.maxTokens ?? 16000 }),
      })

      for await (const { event, data } of readSse(response)) {
        if (event === 'message_stop') return
        if (event === 'error') throw new Error(JSON.parse(data).error?.message ?? data)
        if (event === 'content_block_delta') {
          const { delta } = JSON.parse(data) as { delta: { type: string; text?: string } }
          if (delta.type === 'text_delta' && delta.text) yield delta.text
        }
      }
    },
  }
}
