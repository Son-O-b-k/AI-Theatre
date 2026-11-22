import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PROVIDER_ID, type ModelTarget, type ProviderInfo } from '../../shared/protocol'
import { api } from '../api'

const STORAGE_KEY = 'ai-theatre:model'

function loadTarget(): ModelTarget {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved?.provider && typeof saved.model === 'string') return saved
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return { provider: DEFAULT_PROVIDER_ID, model: '' }
}

/** The saved choice if it still exists; otherwise the default model, which needs no choosing. */
function reconcile(current: ModelTarget, list: ProviderInfo[]): ModelTarget {
  const provider = list.find((p) => p.id === current.provider)
  if (!provider) return { provider: DEFAULT_PROVIDER_ID, model: '' }
  if (provider.source === 'default') return { provider: provider.id, model: '' }
  if (provider.models.length > 0 && !provider.models.includes(current.model)) return { provider: provider.id, model: provider.models[0] }
  return current
}

export function useProviders(onError: (error: unknown) => void) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [target, setTargetState] = useState(loadTarget)

  const refresh = useCallback(() => {
    api
      .providers()
      .then((list) => {
        setProviders(list)
        setTargetState((current) => reconcile(current, list))
      })
      .catch(onError)
  }, [onError])

  useEffect(refresh, [refresh])

  const setTarget = useCallback((next: ModelTarget) => {
    setTargetState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not persisting the choice is fine.
    }
  }, [])

  return { providers, target, setTarget, refresh }
}
