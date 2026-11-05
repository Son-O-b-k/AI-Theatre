import { ArrowUp, Film, GraduationCap, Loader2, PenLine, Square, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import { DEFAULT_LANGUAGE, LANGUAGES } from '../../shared/languages'
import type { Mode } from '../hooks/useGenerator'
import { Button } from './ui/Button'
import { cx } from './ui/cx'

export interface ModeOption {
  mode: Mode
  label: string
  placeholder: string
}

const ICONS: Record<Mode, LucideIcon> = { teach: GraduationCap, scene: Film, refine: PenLine }

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
  /** The language picker, shown for new lessons; other languages are a Pro feature. */
  language?: { value: string; onChange(value: string): void; locked: boolean }
  onSubmit(mode: Mode, prompt: string): void
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
  const canSubmit = !busy && !disabled && value.trim().length > 0

  // Grow with the text up to a limit.
  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const submit = () => {
    if (!canSubmit) return
    onSubmit(current.mode, value.trim())
    if (current.mode !== 'refine') onValueChange('')
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
          placeholder={current.placeholder}
          autoFocus={size === 'hero'}
          onChange={(e) => onValueChange(e.target.value)}
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
        <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
          {modes.map(({ mode: option, label }) => {
            const Icon = ICONS[option]
            return (
              <Button
                key={option}
                size="sm"
                variant={option === current.mode ? 'active' : 'ghost'}
                onClick={() => onModeChange(option)}
                disabled={busy}
              >
                <Icon className="size-3.5" />
                {/* Small screens show only the active mode's name. */}
                <span className={cx(option !== current.mode && 'max-sm:hidden')}>{label}</span>
              </Button>
            )
          })}

          {language && current.mode === 'teach' && (
            <select
              value={language.value}
              onChange={(e) => language.onChange(e.target.value)}
              disabled={busy}
              aria-label="Lesson language"
              title={language.locked ? 'Other languages are part of the Pro plan' : 'The language the lesson is written and narrated in'}
              className="h-8 max-w-36 cursor-pointer rounded-lg bg-transparent px-1.5 text-[13px] text-dim outline-none hover:bg-tint hover:text-ink"
            >
              {LANGUAGES.map((name) => (
                <option key={name} value={name} disabled={language.locked && name !== DEFAULT_LANGUAGE}>
                  {name}
                  {language.locked && name !== DEFAULT_LANGUAGE ? ' (Pro)' : ''}
                </option>
              ))}
            </select>
          )}

          <span className="min-w-0 flex-1" />

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
      {warnings.length > 0 && !busy && (
        <p className="mt-1.5 px-2 text-xs text-faint" title={warnings.join('\n')}>
          The AI's last answer had {warnings.length} small problems that were skipped or could not be fixed (hover to
          read).
        </p>
      )}
    </div>
  )
}
