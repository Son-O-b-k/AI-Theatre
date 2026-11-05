import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button } from './Button'
import { cx } from './cx'

/** A modal panel that closes on Escape, the close button, or a click outside it. */
export function Dialog({ title, onClose, children, wide }: { title: ReactNode; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={cx('w-full rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-ink/20', wide ? 'max-w-2xl' : 'max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="min-w-0 flex-1 font-serif text-2xl font-medium tracking-tight">{title}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A read-only value with a Copy button (links, embed codes). */
export function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const copy = () => navigator.clipboard.writeText(value).catch(() => {})
  const field = 'w-full rounded-lg border border-line bg-raised px-3 py-2 font-mono text-xs text-dim outline-none'
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1.5 flex gap-2">
        {multiline ? <textarea readOnly rows={3} value={value} className={cx(field, 'resize-none')} onFocus={(e) => e.target.select()} /> : <input readOnly value={value} className={field} onFocus={(e) => e.target.select()} />}
        <Button variant="secondary" size="sm" className="h-9 shrink-0" onClick={copy}>
          Copy
        </Button>
      </div>
    </label>
  )
}
