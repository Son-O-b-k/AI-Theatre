import { ArrowUp, FileText, Film, Globe, GraduationCap, Loader2, Paperclip, PenLine, Square, X, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../shared/languages'
import { MAX_SOURCE_CHARS, type SourceText } from '../../shared/protocol'
import { api } from '../api'
import type { Mode } from '../hooks/useGenerator'
import { Button } from './ui/Button'
import { cx } from './ui/cx'

export interface ModeOption {
  mode: Mode
  label: string
  placeholder: string
}

const ICONS: Record<Mode, LucideIcon> = { teach: GraduationCap, scene: Film, refine: PenLine }

/** Documents a lesson can be taught from; the server reads their text (server/sources.ts). */
const SOURCE_TYPES = '.pdf,.docx,.txt,.md,.markdown,.csv'
/** Pasting more than this into the prompt makes it the lesson's source instead. */
const PASTE_AS_SOURCE = 1000

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

function pastedSource(text: string): SourceText {
  const kept = text.trim().slice(0, MAX_SOURCE_CHARS)
  return { name: 'Pasted text', text: kept, words: countWords(kept), truncated: text.trim().length > MAX_SOURCE_CHARS }
}

/** What the lesson is about when only a source is given: the document's name. */
const topicOf = (source: SourceText) =>
  source.name === 'Pasted text' ? 'the main ideas of the source material' : source.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')

interface Props {
  value: string
  onValueChange(value: string): void
  modes: ModeOption[]
  mode: Mode
  onModeChange(mode: Mode): void
  size: 'hero' | 'bar'
  busy: boolean
  status: string
  warnings: string[]
  disabled?: boolean
  /**
   * The language picker, shown for new lessons. Other languages are a Pro feature (`locked`) and need
   * premium voices set up on the server (`available`).
   */
  language?: { value: string; onChange(value: string): void; locked: boolean; available: boolean }
  /** `source` is the text of a document to teach from, attached for new lessons and chapters. */
  onSubmit(mode: Mode, prompt: string, source?: string): void
  onStop(): void
}

export function PromptBox({
  value,
  onValueChange,
  modes,
  mode,
  onModeChange,
  size,
  busy,
  status,
  warnings,
  disabled,
  language,
  onSubmit,
  onStop,
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const current = modes.find((m) => m.mode === mode) ?? modes[0]
  const fileInput = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<SourceText | null>(null)
  const [reading, setReading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const sourceAllowed = current.mode !== 'refine'
  const attached = sourceAllowed ? source : null
  const canSubmit = !busy && !disabled && !reading && (value.trim().length > 0 || attached !== null)

  const readFile = async (file: File) => {
    setSourceError(null)
    setReading(true)
    try {
      setSource(await api.readSource(file))
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : String(error))
    } finally {
      setReading(false)
    }
  }

  // Grow with the text up to a limit.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const submit = () => {
    if (!canSubmit) return
    onSubmit(current.mode, value.trim() || topicOf(attached!), attached?.text)
    if (current.mode !== 'refine') {
      onValueChange('')
      setSource(null)
    }
  }

  return (
    <div>
      <div
        className={cx(
          'rounded-2xl border border-line-strong bg-raised shadow-sm shadow-ink/5 transition focus-within:border-ink/40',
          size === 'hero' && 'shadow-lg',
        )}
      >
        <textarea
          ref={textarea}
          rows={size === 'hero' ? 2 : 1}
          value={value}
          placeholder={attached ? 'What should the lesson focus on? (optional)' : current.placeholder}
          autoFocus={size === 'hero'}
          onChange={(e) => onValueChange(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text/plain')
            if (!sourceAllowed || busy || text.length <= PASTE_AS_SOURCE) return
            e.preventDefault()
            setSourceError(null)
            setSource(pastedSource(text))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          className={cx(
            'block w-full resize-none bg-transparent px-4 outline-none placeholder:text-faint',
            size === 'hero' ? 'pt-4 text-base' : 'pt-3 text-[14px]',
          )}
        />
        {attached && (
          <div className="px-3 pt-1">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-tint py-1 pr-1 pl-2 text-xs text-dim">
              <FileText className="size-3.5 shrink-0 text-accent" />
              <span className="truncate font-medium text-ink">{attached.name}</span>
              <span className="shrink-0">
                · {attached.words.toLocaleString()} words{attached.truncated && ' (the beginning only: the rest is too long to use)'}
              </span>
              <button
                onClick={() => setSource(null)}
                disabled={busy}
                aria-label="Remove source"
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded hover:bg-line hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </span>
          </div>
        )}
        {/* Wraps on a phone rather than pushing the send button out of the box. */}
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-2.5">
          {modes.map(({ mode: option, label }) => {
            const Icon = ICONS[option]
            return (
              <Button
                key={option}
                size="sm"
                variant={option === current.mode ? 'active' : 'ghost'}
                onClick={() => onModeChange(option)}
                aria-label={label}
                title={label}
                disabled={busy}
              >
                <Icon className="size-3.5" />
                {/* Small screens show only the active mode's name. */}
                <span className={cx(option !== current.mode && 'max-sm:hidden')}>{label}</span>
              </Button>
            )
          })}

          {language && current.mode === 'teach' && (
            <label
              className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2 text-[13px] text-dim transition focus-within:border-accent/60 hover:border-line-strong hover:text-ink"
              title={
                !language.available
                  ? 'Lessons in other languages are not available yet'
                  : language.locked
                    ? 'Other languages are part of the Pro plan'
                    : 'The language the lesson is written and narrated in'
              }
            >
              <Globe className="size-3.5 shrink-0" />
              <select
                value={language.value}
                onChange={(e) => language.onChange(e.target.value)}
                disabled={busy}
                aria-label="Lesson language"
                className="max-w-32 cursor-pointer bg-transparent outline-none"
              >
                {LANGUAGES.map((name) => {
                  const why = name === DEFAULT_LANGUAGE ? '' : !language.available ? ' (not available yet)' : language.locked ? ' (Pro)' : ''
                  return (
                    <option key={name} value={name} disabled={why !== ''}>
                      {name}
                      {why}
                    </option>
                  )
                })}
              </select>
            </label>
          )}

          {sourceAllowed && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fileInput.current?.click()}
                disabled={busy || reading}
                title="Teach from a document: PDF, Word or text. You can also paste long text into the box."
              >
                {reading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
                <span className="max-sm:hidden">{reading ? 'Reading…' : attached ? 'Replace source' : 'Source'}</span>
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept={SOURCE_TYPES}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) readFile(file)
                }}
              />
            </>
          )}

          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {busy && (
              <span className="flex min-w-0 items-center gap-2 text-xs text-dim">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
                <span className="truncate">{status}</span>
              </span>
            )}

            {busy ? (
              <Button variant="secondary" size="icon" className="rounded-full" onClick={onStop} aria-label="Stop">
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                className="rounded-full"
                disabled={!canSubmit}
                onClick={submit}
                aria-label={current.label}
              >
                <ArrowUp className="size-[18px]" strokeWidth={2.5} />
              </Button>
            )}
          </div>
        </div>
      </div>
      {sourceError && sourceAllowed && <p className="mt-1.5 px-2 text-xs text-danger">{sourceError}</p>}
      {warnings.length > 0 && !busy && (
        <p className="mt-1.5 px-2 text-xs text-faint" title={warnings.join('\n')}>
          The AI's last answer had {warnings.length} small problems that were skipped or could not be fixed (hover to
          read).
        </p>
      )}
    </div>
  )
}
