import { Check, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './cx'

interface MenuProps {
  trigger(props: { open: boolean; toggle(): void }): ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  side?: 'top' | 'bottom'
}

/** A dropdown that closes on outside click, Escape, or choosing an item. */
export function Menu({ trigger, children, align = 'end', side = 'bottom' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cx(
            'absolute z-30 max-h-[70vh] w-max min-w-64 overflow-y-auto rounded-xl border border-line-strong bg-raised/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur',
            align === 'end' ? 'right-0' : 'left-0',
            side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

interface ItemProps {
  icon: LucideIcon
  children: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** Makes this one of a set of choices, marked when chosen. */
  checked?: boolean
  onSelect(): void
}

export function MenuItem({ icon: Icon, children, hint, danger, disabled, checked, onSelect }: ItemProps) {
  return (
    <button
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] transition',
        'hover:bg-white/6 disabled:pointer-events-none disabled:opacity-40',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <Icon className="size-4 shrink-0 opacity-75" />
      <span className="flex-1 whitespace-nowrap">{children}</span>
      {hint && <span className="ml-4 max-w-40 truncate text-xs text-faint">{hint}</span>}
      {checked !== undefined && <Check className={cx('size-4 shrink-0 text-accent', !checked && 'invisible')} />}
    </button>
  )
}

export const MenuSeparator = () => <div className="my-1.5 h-px bg-line" />

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{children}</div>
)
