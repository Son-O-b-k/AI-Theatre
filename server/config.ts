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
  if (existsSync('.env')) process.loadEnvFile('.env')

  const file =
    process.env.PROVIDERS_FILE ?? (existsSync('providers.json') ? 'providers.json' : 'providers.example.json')
  const config = ConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  console.log(`Loaded ${config.providers.length} providers from ${file}`)

  return config.providers.map((provider) => ({ ...provider, apiKey: resolveSecret(provider.apiKey) }))
}

function resolveSecret(value: string | undefined): string | undefined {
  return value?.startsWith('env:') ? process.env[value.slice(4)] : value
}
