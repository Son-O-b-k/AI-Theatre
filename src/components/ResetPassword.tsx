import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { AuthScreen, Field } from './SignIn'
import { Button } from './ui/Button'

/** Opened from the emailed reset link: choose a new password, then carry on signed in. */
export function ResetPassword({ token, onDone }: { token: string; onDone(): void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.resetPassword(token, password)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <AuthScreen heading="Choose a new password" intro="You will be signed in with it, and signed out everywhere else.">
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={setPassword} hint="At least 8 characters." />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || !password}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Save and sign in
        </Button>
      </form>
    </AuthScreen>
  )
}
