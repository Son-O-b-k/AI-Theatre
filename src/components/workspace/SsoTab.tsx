import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SsoConnection } from '../../../shared/protocol'
import { api } from '../../api'
import { Button } from '../ui/Button'
import { CopyField } from '../ui/Dialog'

const field = 'h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-ink/50'
const EMPTY = { domain: '', issuer: '', clientId: '', clientSecret: '', enforced: false }

/** Single sign-on with the organisation's identity provider (OpenID Connect). */
export function SsoTab({ isOwner }: { isOwner: boolean }) {
  const [saved, setSaved] = useState<SsoConnection | null | undefined>(undefined)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.sso().then((connection) => {
      setSaved(connection)
      if (connection) setForm({ ...connection, clientSecret: '' })
    }, (e) => setError(e.message))
  }, [])

  const act = async (action: () => Promise<SsoConnection | null>) => {
    setBusy(true)
    setError(null)
    try {
      const connection = await action()
      setSaved(connection)
      setForm(connection ? { ...connection, clientSecret: '' } : EMPTY)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (saved === undefined && !error) return <Loader2 className="mx-auto my-6 size-5 animate-spin text-faint" />

  return (
    <div>
      <p className="text-sm text-dim">
        Let people from your organisation sign in with its accounts: Google Workspace, Microsoft Entra, Okta or any OpenID Connect
        provider. They join this workspace on their first sign-in, while seats last.
      </p>
      <div className="mt-4">
        <CopyField label="Redirect URI to register with your provider" value={`${location.origin}/api/auth/sso/callback`} />
      </div>
      {isOwner ? (
        <form
          className="mt-4 grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            act(() => api.saveSso({ ...form, clientSecret: form.clientSecret || undefined }))
          }}
        >
          <input className={field} placeholder="Email domain, e.g. school.org" required value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <input className={field} placeholder="Issuer URL, e.g. https://accounts.google.com" required value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
          <input className={field} placeholder="Client ID" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
          <input
            className={field}
            type="password"
            autoComplete="off"
            placeholder={saved ? 'Client secret (leave empty to keep)' : 'Client secret'}
            value={form.clientSecret}
            onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={form.enforced} onChange={(e) => setForm({ ...form, enforced: e.target.checked })} />
            Require single sign-on for this domain (turns off passwords for its addresses)
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} {saved ? 'Save changes' : 'Turn on single sign-on'}
            </Button>
            {saved && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => act(async () => (await api.removeSso(), null))}>
                Turn off
              </Button>
            )}
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm">{saved ? `On for ${saved.domain}${saved.enforced ? ', required' : ''}.` : 'Not set up.'}</p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
