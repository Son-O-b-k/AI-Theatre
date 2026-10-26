import { readLines } from '../../shared/lines'

/** `fetch` that throws a readable error for non-2xx responses. */
export async function request(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`${response.status} ${response.statusText} from ${new URL(url).host}: ${detail}`)
  }
  return response
}

export interface SseEvent {
  event: string
  data: string
}

/** Minimal server-sent events reader: enough for OpenAI and Anthropic streams. */
export async function* readSse(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) throw new Error('Response has no body')

  let event = 'message'
  let data: string[] = []

  for await (const line of readLines(response.body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') }
      event = 'message'
      data = []
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart())
    }
  }
  if (data.length) yield { event, data: data.join('\n') }
}

export const trimSlash = (url: string) => url.replace(/\/+$/, '')
