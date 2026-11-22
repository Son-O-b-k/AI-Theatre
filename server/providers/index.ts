import { DEFAULT_PROVIDER_ID, type ProviderInfo, type ProviderSource } from '../../shared/protocol'
import type { DefaultModel, ProviderConfig } from '../config'
import { anthropic } from './anthropic'
import { openAiCompatible } from './openai'
import type { Provider } from './types'

export function createProvider(config: ProviderConfig): Provider {
  const provider = config.kind === 'anthropic' ? anthropic(config) : openAiCompatible({ ...config, kind: config.kind })
  if (!config.models) return provider

  const models = config.models
  return { ...provider, listModels: async () => models }
}

export async function describeProvider(provider: Provider, source: ProviderSource): Promise<ProviderInfo> {
  const info = { id: provider.id, label: provider.label, kind: provider.kind, source }
  try {
    return { ...info, models: await provider.listModels() }
  } catch (error) {
    return { ...info, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The server's default model, for people who have not chosen one: the provider and model named in
 * .env, or else the first provider that answers and the first model it lists. Null when none answers.
 */
export async function resolveDefault(providers: Map<string, Provider>, wanted: DefaultModel): Promise<{ provider: Provider; model: string } | null> {
  const named = wanted.provider ? providers.get(wanted.provider) : undefined
  if (wanted.provider && !named) console.warn(`AI_DEFAULT_PROVIDER "${wanted.provider}" is not in the providers file`)
  for (const provider of named ? [named] : providers.values()) {
    if (wanted.model && named) return { provider, model: wanted.model }
    const models = await provider.listModels().catch((): string[] => [])
    const model = wanted.model && models.includes(wanted.model) ? wanted.model : models[0]
    if (model) return { provider, model }
  }
  return null
}

/** The entry for the default model in the model list. It does not say which provider or model runs it. */
export async function describeDefault(providers: Map<string, Provider>, wanted: DefaultModel): Promise<ProviderInfo> {
  const info = { id: DEFAULT_PROVIDER_ID, label: 'AI Theatre', kind: 'openai' as const, source: 'default' as const, models: [] }
  const resolved = await resolveDefault(providers, wanted)
  return resolved ? info : { ...info, error: 'AI Theatre is not available right now. Try again soon, or add your own key.' }
}

export type { Provider }
