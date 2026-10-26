import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

const VARIANTS = {
  primary:
    'bg-gradient-to-r from-accent to-accent-2 text-canvas font-semibold shadow-lg shadow-accent/20 hover:brightness-110',
  secondary: 'bg-raised text-ink border border-line hover:border-line-strong hover:bg-hover',
  ghost: 'text-dim hover:text-ink hover:bg-white/5',
  active: 'bg-accent/15 text-accent',
}

const SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  icon: 'size-9 justify-center',
  'icon-sm': 'size-8 justify-center',
  'icon-lg': 'size-11 justify-center',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: Props) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center rounded-lg font-medium whitespace-nowrap transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
}
