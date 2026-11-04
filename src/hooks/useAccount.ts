import { useCallback, useEffect, useState } from 'react'
import type { AccountInfo } from '../../shared/protocol'
import { api, ApiError } from '../api'

/** The signed-in account: undefined while loading, null when signed out. */
export function useAccount() {
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      setAccount(await api.me())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setAccount(null)
      else throw error
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setAccount(null))
  }, [refresh])

  const signIn = useCallback(
    async (mode: 'signin' | 'signup', email: string, password: string) => {
      await (mode === 'signup' ? api.signUp(email, password) : api.signIn(email, password))
      await refresh()
    },
    [refresh],
  )

  const signOut = useCallback(async () => {
    await api.signOut()
    setAccount(null)
  }, [])

  return { account, refresh, signIn, signOut }
}
