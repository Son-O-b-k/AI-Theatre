import { cx } from './ui/cx'

/** A small chalkboard with a stroke of chalk, and the name set in the serif. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-7" />
      <span className="font-serif text-[19px] font-semibold tracking-tight">AI Theatre</span>
    </span>
  )
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="1" y="3" width="30" height="24" rx="5" fill="#1d2422" />
      <path d="M7 19c3-6 6-6 9-2s6 4 9-3" fill="none" stroke="#f3f0e8" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="25" cy="14" r="2.6" fill="#c8402a" />
      <rect x="9" y="28" width="14" height="2.5" rx="1.25" fill="#1d2422" />
    </svg>
  )
}
