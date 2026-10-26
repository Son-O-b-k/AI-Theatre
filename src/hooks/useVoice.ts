import { useCallback, useEffect, useState } from 'react'
import type { VoiceInfo } from '../../shared/protocol'
import { api } from '../api'
import { BROWSER_VOICE } from '../narration'

const STORAGE_KEY = 'ai-theatre:voice'
const DEFAULT_VOICE = 'af_heart'

function loadVoice(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_VOICE
  } catch {
    return DEFAULT_VOICE // storage can be unavailable (private mode)
  }
}

/** The narration voices the server offers and the one chosen for new chapters. */
export function useVoice() {
  const [voices, setVoices] = useState<VoiceInfo[]>([])
  const [voice, setVoiceState] = useState(loadVoice)

  useEffect(() => {
    api
      .voices()
      .then((list) => {
        setVoices(list)
        setVoiceState((current) => (current === BROWSER_VOICE || list.some((v) => v.id === current) ? current : list[0]?.id ?? BROWSER_VOICE))
      })
      .catch(() => setVoiceState(BROWSER_VOICE)) // an older server without speech
  }, [])

  const setVoice = useCallback((next: string) => {
    setVoiceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Not persisting the choice is fine.
    }
  }, [])

  return { voices, voice, setVoice }
}
