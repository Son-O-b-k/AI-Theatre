// Providers fail in their own words: a status code, a JSON body, a socket error. People see these
// when a lesson cannot be written, so they are put in plain words that say what to do next.

/** A provider answered with an error status. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly host: string,
    /** The provider's own explanation, from its JSON body when it sent one. */
    readonly detail: string,
  ) {
    super(`${status} from ${host}: ${detail}`)
  }
}

/** The message inside the error bodies OpenAI, Anthropic, Ollama and most compatible servers send. */
export function detailOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string | { message?: string }; message?: string; detail?: string }
    const text = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message ?? parsed.detail)
    if (text) return String(text)
  } catch {
    // Not JSON: an HTML error page or plain text.
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface Context {
  /** The provider's name as people know it ("Anthropic", "My Ollama"). */
  label: string
  kind: string
  model?: string
  /** The workspace's own key: its owner can fix keys and credit. Otherwise the server's model is at fault. */
  own: boolean
}

const NO_CREDIT = /credit balance|insufficient[_ ]quota|exceeded your (current )?quota|billing|payment required|out of credits/i
const NO_MODEL = /model.*(not found|does not exist|not_found|unknown|no such)|unknown model|model_not_found/i
const TOO_LONG = /context (length|window)|too long|maximum context|prompt is too long|too many tokens/i
const OVERLOADED = /overloaded|temporarily unavailable|server error|bad gateway|service unavailable/i

/**
 * What went wrong, for the person who asked. Errors that are not the provider's (a lesson the
 * model wrote badly, say) are returned as they are.
 */
export function explainProviderError(error: unknown, context: Context): string {
  const raw = error instanceof Error ? error.message : String(error)
  const who = context.own ? context.label : 'AI Theatre'
  // People cannot fix the server's own key or credit; they can wait or bring their own.
  const notYours = 'AI Theatre’s model is not available right now. Try again soon, or add your own AI key under Workspace → AI models.'

  if (error instanceof ProviderHttpError) {
    const { status, detail } = error
    if (status === 402 || NO_CREDIT.test(detail)) {
      return context.own ? `Your ${who} account is out of credit. Add credit on ${who}'s website, or choose another model.` : notYours
    }
    if (status === 401 || status === 403) {
      return context.own ? `${who} did not accept the API key. Check it under Workspace → AI models.` : notYours
    }
    if (TOO_LONG.test(detail) || status === 413) {
      return 'This is too long for the model to read. Use a shorter source document, or a model that reads more at once.'
    }
    if (status === 404 || NO_MODEL.test(detail)) {
      const model = context.model ? `the model “${context.model}”` : 'that model'
      return context.own ? `${who} does not offer ${model}. Choose another model.` : notYours
    }
    if (status === 429) return `${who} is busy with too many requests right now. Wait a minute and try again.`
    if (status >= 500 || OVERLOADED.test(detail)) return `${who} is having trouble right now. Try again in a few minutes.`
    return `${who} refused the request: ${firstLine(detail)}`
  }

  if (isNetworkError(error)) {
    if (!context.own) return notYours
    return context.kind === 'ollama'
      ? `Could not reach ${who}. Is Ollama running, and is its address right under Workspace → AI models?`
      : `Could not reach ${who}. Check your server's internet connection and the provider's address.`
  }
  if (error instanceof Error && error.name === 'TimeoutError') return `${who} took too long to answer. Try again in a few minutes.`
  // Errors sent in the middle of a stream (Anthropic's "Overloaded", for one).
  if (OVERLOADED.test(raw)) return `${who} is having trouble right now. Try again in a few minutes.`
  return raw
}

/** fetch() failing before any answer: refused connection, unknown host, dropped socket. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error.cause as { code?: string } | undefined)?.code ?? ''
  return error.message === 'fetch failed' || /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|UND_ERR_)/.test(code)
}

const firstLine = (text: string) => text.split('\n')[0].slice(0, 200)
