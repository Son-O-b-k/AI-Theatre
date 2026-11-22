import { Check, ExternalLink, Loader2, Plug, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PLANS, type PlanId } from '../../../shared/plans'
import type { NewWorkspaceProvider, WorkspaceProvider } from '../../../shared/protocol'
import { api } from '../../api'
import { Button } from '../ui/Button'
import { cx } from '../ui/cx'

interface Preset {
  id: string
  label: string
  kind: NewWorkspaceProvider['kind']
  /** Fixed address; when absent and `askUrl` is set, the person types it. */
  baseUrl?: string
  askUrl?: string
  needsKey: boolean
  keyHint?: string
  keyPage?: string
}

/** The providers people most often have a key for; anything OpenAI-compatible works through "Other". */
const PRESETS: Preset[] = [
  { id: 'openai', label: 'OpenAI', kind: 'openai', needsKey: true, keyHint: 'sk-…', keyPage: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', needsKey: true, keyHint: 'sk-ant-…', keyPage: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, keyHint: 'AIza…', keyPage: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, keyHint: 'sk-or-…', keyPage: 'https://openrouter.ai/keys' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, keyHint: 'gsk_…', keyPage: 'https://console.groq.com/keys' },
  { id: 'ollama', label: 'Ollama', kind: 'ollama', askUrl: 'http://your-server:11434/v1', needsKey: false },
  { id: 'other', label: 'Other (OpenAI-compatible)', kind: 'openai', askUrl: 'https://api.example.com/v1', needsKey: false },
]

const field = 'h-9 w-full rounded-lg border border-line-strong bg-raised px-3 text-sm outline-none focus:border-ink/50'

/** The workspace's own AI providers: its keys or servers, used instead of ours, on its own allowance. */
export function ProvidersTab({ isOwner, plan, onChanged }: { isOwner: boolean; plan: PlanId; onChanged(): void }) {
  const [list, setList] = useState<WorkspaceProvider[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const own = PLANS[plan].ownKeyLessons

  const reload = () => api.workspaceProviders().then(setList, (e) => setError(e.message))
  useEffect(() => void reload(), [])

  const remove = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.removeWorkspaceProvider(id)
      await reload()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-dim">
        Use your own AI account. Lessons made with it are paid for on your key, so they don't use your plan's lessons. On {PLANS[plan].name} you
        can make {own === null ? 'as many as you like' : `${own} a month`} this way.
        {own !== null && ' Narration, storage and video still run on AI Theatre, which is why there is a limit.'}
      </p>
      {!list && !error && <Loader2 className="mx-auto my-6 size-5 animate-spin text-faint" />}
      {list && list.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-raised">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <Plug className="size-4 shrink-0 text-faint" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.label}</span>
                <span className="block truncate text-xs text-faint">
                  {p.models.length > 0 ? p.models.join(', ') : 'Every model on this account'}
                  {p.hasKey ? ' · key stored encrypted' : ''}
                </span>
              </span>
              {isOwner && (
                <Button variant="ghost" size="icon-sm" title="Remove" disabled={busy} onClick={() => remove(p.id)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isOwner ? (
        <AddProvider
          onAdded={async () => {
            await reload()
            onChanged()
          }}
        />
      ) : (
        <p className="mt-4 text-sm text-dim">Only the workspace owner can add keys.</p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  )
}

/** Choose a provider → paste the key → connect (checks it and lists its models) → save. */
function AddProvider({ onAdded }: { onAdded(): Promise<void> }) {
  const [preset, setPreset] = useState<Preset | null>(null)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [allModels, setAllModels] = useState(true)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (next: Preset) => {
    setPreset(next)
    setLabel(next.id === 'other' ? '' : next.label)
    setBaseUrl('')
    setApiKey('')
    setModels(null)
    setChosen(new Set())
    setAllModels(true)
    setError(null)
  }

  const draft = (): NewWorkspaceProvider | null =>
    preset && { label: label.trim() || preset.label, kind: preset.kind, baseUrl: preset.baseUrl ?? (baseUrl.trim() || undefined), apiKey: apiKey.trim() || undefined }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const connect = () => run(async () => setModels((await api.checkWorkspaceProvider(draft()!)).models))

  const save = () =>
    run(async () => {
      await api.addWorkspaceProvider({ ...draft()!, models: allModels ? [] : [...chosen] })
      setPreset(null)
      await onAdded()
    })

  const shown = useMemo(() => (models ?? []).filter((m) => m.toLowerCase().includes(filter.toLowerCase())), [models, filter])
  const ready = preset && (!preset.needsKey || apiKey.trim()) && (!preset.askUrl || baseUrl.trim())

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium tracking-wide text-faint uppercase">Add a provider</p>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => choose(p)}
            className={cx(
              'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition',
              preset?.id === p.id ? 'border-ink bg-ink text-panel' : 'border-line-strong bg-raised hover:border-ink/40',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset && (
        <form
          className="mt-4 grid gap-3 rounded-xl border border-line bg-raised p-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (models) save()
            else connect()
          }}
        >
          {preset.askUrl && (
            <label className="grid gap-1 text-sm">
              <span className="text-dim">Server address</span>
              <input
                className={field}
                placeholder={preset.askUrl}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  setModels(null)
                }}
                required
              />
              {preset.kind === 'ollama' && (
                <span className="text-xs text-faint">AI Theatre's server must be able to reach it. For Ollama on your own computer, use a tunnel such as ngrok.</span>
              )}
            </label>
          )}
          <label className="grid gap-1 text-sm">
            <span className="flex items-center justify-between text-dim">
              API key {!preset.needsKey && '(if your server needs one)'}
              {preset.keyPage && (
                <a href={preset.keyPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  Get a key <ExternalLink className="size-3" />
                </a>
              )}
            </span>
            <input
              className={field}
              type="password"
              autoComplete="off"
              placeholder={preset.keyHint ?? 'Optional'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value)
                setModels(null)
              }}
              required={preset.needsKey}
            />
          </label>

          {!models ? (
            <div>
              <Button type="submit" variant="primary" size="sm" disabled={busy || !ready}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Connect
              </Button>
              <span className="ml-3 text-xs text-faint">We check the key and load the models it can use.</span>
            </div>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                <Check className="size-4" /> Connected. {models.length} model{models.length === 1 ? '' : 's'} available.
              </p>
              <label className="grid gap-1 text-sm">
                <span className="text-dim">Name in the model list</span>
                <input className={field} value={label} placeholder={preset.label} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <fieldset className="grid gap-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" checked={allModels} onChange={() => setAllModels(true)} /> Offer every model (new ones appear by themselves)
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" checked={!allModels} onChange={() => setAllModels(false)} /> Choose which models to offer
                </label>
              </fieldset>
              {!allModels && (
                <div className="rounded-lg border border-line">
                  <div className="flex items-center gap-2 border-b border-line px-2">
                    <Search className="size-3.5 text-faint" />
                    <input className="h-8 w-full bg-transparent text-sm outline-none" placeholder="Filter models" value={filter} onChange={(e) => setFilter(e.target.value)} />
                    <span className="shrink-0 text-xs text-faint">{chosen.size} chosen</span>
                  </div>
                  <ul className="max-h-48 overflow-y-auto py-1">
                    {shown.map((model) => (
                      <li key={model}>
                        <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-panel">
                          <input
                            type="checkbox"
                            checked={chosen.has(model)}
                            onChange={(e) => {
                              const next = new Set(chosen)
                              if (e.target.checked) next.add(model)
                              else next.delete(model)
                              setChosen(next)
                            }}
                          />
                          <span className="truncate">{model}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={busy || (!allModels && chosen.size === 0)}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />} Save provider
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPreset(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </div>
  )
}
