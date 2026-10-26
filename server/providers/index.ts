import type { ProviderInfo } from '../../shared/protocol'
import type { ProviderConfig } from '../config'
import { anthropic } from './anthropic'
import { openAiCompatible } from './openai'
import type { Provider } from './types'

export function createProvider(config: ProviderConfig): Provider {
  const provider = config.kind === 'anthropic' ? anthropic(config) : openAiCompatible({ ...config, kind: config.kind })
  if (!config.models) return provider

  const models = config.models
  return { ...provider, listModels: async () => models }
}

export async function describeProvider(provider: Provider): Promise<ProviderInfo> {
  const info = { id: provider.id, label: provider.label, kind: provider.kind }
  try {
    return { ...info, models: await provider.listModels() }
  } catch (error) {
    return { ...info, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export type { Provider }
