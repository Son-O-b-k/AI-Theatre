import { Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { NewWorkspaceProvider, WorkspaceProvider } from '../../../shared/protocol'
import { api } from '../../api'
import { Button } from '../ui/Button'

const EMPTY = { label: '', kind: 'openai' as NewWorkspaceProvider['kind'], baseUrl: '', apiKey: '', models: '' }

const field = 'h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-ink/50'

/** The workspace's own AI providers: its keys or servers, used instead of ours, without using the allowance. */
export function ProvidersTab({ isOwner, onChanged }: { isOwner: boolean; onChanged(): void }) {
  const [list, setList] = useState<WorkspaceProvider[] | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.workspaceProviders().then(setList, (e) => setError(e.message))
  }, [])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setList(await api.workspaceProviders())
      onChanged()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    const models = form.models.split(',').map((m) => m.trim()).filter(Boolean)
    const ok = await act(() =>
      api.addWorkspaceProvider({ label: form.label, kind: form.kind, baseUrl: form.baseUrl || undefined, apiKey: form.apiKey || undefined, models }),
    )
    if (ok) setForm(EMPTY)
  }

  return (
    <div>
      <p className="text-sm text-dim">
        Use your organisation's own AI account or server. Its keys are stored encrypted, lessons made with it do not use your monthly
        allowance, and it appears in everyone's model list.
      </p>
      {!list && !error && <Loader2 className="mx-auto my-6 size-5 animate-spin text-faint" />}
      {list && list.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-raised">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.label}</span>
                <span className="block truncate text-xs text-faint">
                  {p.kind} · {p.models.join(', ')} {p.hasKey ? '· key stored' : ''}
                </span>
              </span>
              {isOwner && (
                <Button variant="ghost" size="icon-sm" title="Remove" disabled={busy} onClick={() => act(() => api.removeWorkspaceProvider(p.id))}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <form
          className="mt-4 grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
        >
          <input className={field} placeholder="Name, e.g. Our Azure OpenAI" required value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <select className={field} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as NewWorkspaceProvider['kind'] })}>
            <option value="openai">OpenAI or compatible API</option>
            <option value="anthropic">Anthropic</option>
            <option value="ollama">Ollama server</option>
          </select>
          <input className={field} placeholder="API address (optional for OpenAI and Anthropic)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          <input className={field} type="password" placeholder="API key" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          <input className={`${field} sm:col-span-2`} placeholder="Models, separated by commas" required value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })} />
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" disabled={busy}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} Add provider
            </Button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}
