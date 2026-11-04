import { useEffect, useRef, useState } from 'react'
import type { InvitationDetails } from '../shared/protocol'
import { api } from './api'
import { App } from './App'
import { ResetPassword } from './components/ResetPassword'
import { SignIn } from './components/SignIn'
import { useAccount } from './hooks/useAccount'

/** The emailed links land on /app/verify, /app/reset and /app/invite with a token. */
type Link = { kind: 'verify' | 'reset' | 'invite'; token: string } | null

function readLink(): Link {
  const kind = location.pathname.match(/^\/app\/(verify|reset|invite)$/)?.[1] as 'verify' | 'reset' | 'invite' | undefined
  const token = new URLSearchParams(location.search).get('token')
  return kind && token ? { kind, token } : null
}

const leaveLink = () => history.replaceState(null, '', '/app')
const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The app needs an account: show sign-in until there is one, and handle the emailed links. */
export function AccountGate() {
  const { account, refresh, signIn, signOut } = useAccount()
  const [link, setLink] = useState(readLink)
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Links are single-use; this keeps a link from being used twice (React may run effects twice). */
  const used = useRef(false)

  const finish = (text: string) => {
    leaveLink()
    setLink(null)
    setNotice(text)
    refresh()
  }

  // Confirming an email works signed in or out.
  useEffect(() => {
    if (link?.kind !== 'verify' || used.current) return
    used.current = true
    api.verifyEmail(link.token).then(
      () => finish('Thanks, your email address is confirmed.'),
      (error) => finish(message(error)),
    )
  }, [link])

  // An invitation: show who invited whom; accept as soon as the right account is signed in.
  useEffect(() => {
    if (link?.kind !== 'invite' || account === undefined) return
    if (account === null) {
      api.invitation(link.token).then(setInvitation, (error) => finish(message(error)))
      return
    }
    if (used.current) return
    used.current = true
    api.acceptInvitation(link.token).then(
      () => finish('Welcome to the team! You are now working in its library.'),
      (error) => finish(message(error)),
    )
  }, [link, account])

  if (link?.kind === 'reset') return <ResetPassword token={link.token} onDone={() => finish('Your new password is saved.')} />
  if (account === undefined || link?.kind === 'verify') return null
  if (account === null) {
    if (link?.kind === 'invite' && !invitation) return null
    return <SignIn onSubmit={signIn} onForgot={api.forgotPassword} invitation={invitation ?? undefined} />
  }
  if (link?.kind === 'invite') return null
  return <App account={account} onAccountChange={refresh} onSignOut={signOut} initialNotice={notice} />
}
