import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const ProviderConfigSchema = z.object({
  id: z.string().regex(/^[\w-]+$/),
  label: z.string().optional(),
  kind: z.enum(['openai', 'anthropic', 'ollama']),
  baseUrl: z.string().url().optional(),
  /** A literal key, or `env:NAME` to read it from the environment. */
  apiKey: z.string().optional(),
  /** Fixed model list. When omitted the provider's model endpoint is queried. */
  models: z.array(z.string()).optional(),
  maxTokens: z.number().int().positive().optional(),
})

const ConfigSchema = z.object({ providers: z.array(ProviderConfigSchema).min(1) })

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export async function loadProviderConfigs(): Promise<ProviderConfig[]> {

  const file =
    process.env.PROVIDERS_FILE ?? (existsSync('providers.json') ? 'providers.json' : 'providers.example.json')
  const config = ConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  console.log(`Loaded ${config.providers.length} providers from ${file}`)

  // A provider that names a key (e.g. env:OPENAI_API_KEY) cannot work while that key is empty, so it
  // is not offered. One that names none (Ollama, a local server) is offered as it is.
  const usable = config.providers.filter((provider) => !provider.apiKey || resolveSecret(provider.apiKey))
  for (const provider of config.providers) if (!usable.includes(provider)) console.log(`AI provider "${provider.id}" has no API key; not offered`)
  return usable.map((provider) => ({ ...provider, apiKey: resolveSecret(provider.apiKey) }))
}

/**
 * The model used when a person has not chosen one: AI_DEFAULT_PROVIDER (an id from providers.json)
 * and AI_DEFAULT_MODEL in .env. Unset, the first provider and the first model it lists are used.
 */
export interface DefaultModel {
  provider?: string
  model?: string
}

export function defaultModelFromEnv(): DefaultModel {
  return { provider: process.env.AI_DEFAULT_PROVIDER || undefined, model: process.env.AI_DEFAULT_MODEL || undefined }
}

/** A literal value, or `env:NAME` to read it from the environment. */
export function resolveSecret(value: string | undefined): string | undefined {
  return value?.startsWith('env:') ? process.env[value.slice(4)] : value
}
