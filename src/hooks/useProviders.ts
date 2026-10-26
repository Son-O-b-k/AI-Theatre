import { useCallback, useEffect, useState } from 'react'
import type { ProviderInfo } from '../../shared/protocol'
import type { ModelTarget } from '../ai/generate'
import { api } from '../api'

const STORAGE_KEY = 'ai-theatre:model'

function loadTarget(): ModelTarget {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved?.provider && typeof saved.model === 'string') return saved
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return { provider: '', model: '' }
}

export function useProviders(onError: (error: unknown) => void) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [target, setTargetState] = useState(loadTarget)

  useEffect(() => {
    api
      .providers()
      .then((list) => {
        setProviders(list)
        setTargetState((current) => {
          if (list.some((p) => p.id === current.provider)) return current
          const first = list.find((p) => p.models.length > 0) ?? list[0]
          return first ? { provider: first.id, model: first.models[0] ?? '' } : current
        })
      })
      .catch(onError)
  }, [onError])

  const setTarget = useCallback((next: ModelTarget) => {
    setTargetState(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not persisting the choice is fine.
    }
  }, [])

  return { providers, target, setTarget }
}
