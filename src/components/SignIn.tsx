import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { InvitationDetails } from '../../shared/protocol'
import { Logo } from './Logo'
import { Button } from './ui/Button'

type Mode = 'signin' | 'signup' | 'forgot'

interface Props {
  onSubmit(mode: 'signin' | 'signup', email: string, password: string): Promise<void>
  onForgot(email: string): Promise<void>
  /** Signing in to accept this invitation: the address is fixed and the heading names the team. */
  invitation?: InvitationDetails
}

export function SignIn({ onSubmit, onForgot, invitation }: Props) {
  const [mode, setMode] = useState<Mode>(invitation ? 'signup' : 'signin')
  const [email, setEmail] = useState(invitation?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const switchTo = (next: Mode) => {
    setMode(next)
    setError(null)
    setSent(false)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'forgot') {
        await onForgot(email)
        setSent(true)
      } else {
        await onSubmit(mode, email, password)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const heading = invitation
    ? `Join ${invitation.workspace}`
    : { signin: 'Welcome back', signup: 'Create your account', forgot: 'Reset your password' }[mode]
  const intro = invitation
    ? `${invitation.inviter} invited ${invitation.email}. ${mode === 'signup' ? 'Create your account' : 'Sign in'} to accept.`
    : {
        signin: 'Sign in to your lessons.',
        signup: 'Start on the Free plan: 3 lessons a month, no card needed.',
        forgot: 'Enter your email and we will send you a link to choose a new password.',
      }[mode]

  return (
    <AuthScreen heading={heading} intro={intro}>
      {sent ? (
        <p className="mt-8 rounded-lg border border-line bg-raised p-4 text-[15px]">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. It works for one hour.
        </p>
      ) : (
        <form
          className="mt-8 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} readOnly={Boolean(invitation)} />
          {mode !== 'forgot' && (
            <Field
              label="Password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={setPassword}
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy || !email || (mode !== 'forgot' && !password)}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {{ signin: 'Sign in', signup: 'Create account', forgot: 'Send reset link' }[mode]}
          </Button>
        </form>
      )}
      <div className="mt-6 space-y-2 text-sm text-dim">
        {mode === 'signin' && (
          <p>
            <LinkButton onClick={() => switchTo('forgot')}>Forgot your password?</LinkButton>
          </p>
        )}
        <p>
          {mode === 'signup' ? 'Already have an account? ' : mode === 'signin' ? 'New here? ' : 'Remembered it? '}
          <LinkButton onClick={() => switchTo(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </LinkButton>
        </p>
      </div>
    </AuthScreen>
  )
}

/** The frame shared by the sign-in, reset and invitation screens. */
export function AuthScreen({ heading, intro, children }: { heading: string; intro: string; children: ReactNode }) {
  return (
    <div className="grid min-h-full place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <a href="/" aria-label="AI Theatre home">
          <Logo />
        </a>
        <h1 className="mt-10 font-serif text-3xl font-medium tracking-tight">{heading}</h1>
        <p className="mt-2 text-[15px] text-dim">{intro}</p>
        {children}
      </div>
    </div>
  )
}

function LinkButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer font-medium text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink">
      {children}
    </button>
  )
}

interface FieldProps {
  label: string
  type: string
  autoComplete: string
  value: string
  hint?: string
  readOnly?: boolean
  onChange(value: string): void
}

export function Field({ label, hint, onChange, ...input }: FieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...input}
        required
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-11 w-full rounded-lg border border-line-strong bg-raised px-3 text-[15px] outline-none read-only:bg-tint read-only:text-dim focus:border-ink/50"
      />
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}
