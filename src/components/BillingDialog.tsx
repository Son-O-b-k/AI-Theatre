import { CreditCard, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LESSON_TOKENS, PLANS, isUpgrade, type Interval } from '../../shared/plans'
import type { BillingSummary } from '../../shared/protocol'
import { api } from '../api'
import { Button } from './ui/Button'
import { cx } from './ui/cx'

interface Props {
  billing: BillingSummary
  /** Only the workspace owner buys or changes the plan. */
  canManage: boolean
  /** Buying needs a confirmed email address (receipts and payment problems go there). */
  emailVerified: boolean
  onChanged(): void
  onClose(): void
}

const SELLABLE = ['creator', 'pro'] as const
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '')

export function BillingDialog({ billing, canManage, emailVerified, onChanged, onClose }: Props) {
  const subscription = billing.subscription
  const paying = billing.plan !== 'free' && subscription !== null
  const [interval, setBillingInterval] = useState<Interval>(subscription?.interval ?? 'month')
  const [discountCode, setDiscountCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const act = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const choose = (plan: 'creator' | 'pro') =>
    act(plan, async () => {
      if (!paying) {
        const { url } = await api.checkout({ plan, interval, discountCode: discountCode || undefined })
        location.href = url // the payment page; it returns to /app?billing=success
        return
      }
      const upgrade = isUpgrade(subscription.plan, plan) || (plan === subscription.plan && interval === 'year')
      const message = upgrade
        ? `Switch to ${PLANS[plan].name} (${interval}ly) now? You will be charged the difference for the rest of this billing period.`
        : `Switch to ${PLANS[plan].name} (${interval}ly)? You keep ${PLANS[subscription.plan].name} until ${formatDate(subscription.currentPeriodEnd)}, then the new price applies.`
      if (confirm(message)) await api.changePlan({ plan, interval })
    })

  const blocked = !canManage
    ? 'Only the owner of this workspace can change its plan.'
    : !paying && !emailVerified
      ? 'Confirm your email address first: use the link we sent you.'
      : null
  const lessonsUsed = billing.tokensUsed / LESSON_TOKENS
  const allowance = PLANS[billing.plan].lessons

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Plan and billing"
        className="w-full max-w-2xl rounded-2xl border border-line bg-panel p-6 shadow-2xl shadow-ink/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-2xl font-medium tracking-tight">Plan and billing</h2>
            <p className="mt-1 text-sm text-dim">
              You are on <strong className="font-semibold text-ink">{PLANS[billing.plan].name}</strong>
              {subscription && paying && <> · {status(subscription)}</>}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <UsageBar used={lessonsUsed} allowance={allowance} className="mt-5" />

        <div className="mt-6 flex items-center justify-between gap-4">
          <h3 className="font-medium">{paying ? 'Change plan' : 'Upgrade'}</h3>
          <div className="flex rounded-lg border border-line bg-raised p-0.5 text-[13px]">
            {(['month', 'year'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setBillingInterval(option)}
                className={cx('cursor-pointer rounded-md px-3 py-1 transition', interval === option ? 'bg-ink text-canvas' : 'text-dim hover:text-ink')}
              >
                {option === 'month' ? 'Monthly' : 'Yearly · 2 months free'}
              </button>
            ))}
          </div>
        </div>

        {blocked && <p className="mt-3 rounded-lg bg-tint px-3 py-2 text-sm text-dim">{blocked}</p>}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {SELLABLE.map((id) => {
            const plan = PLANS[id]
            const current = paying && subscription.plan === id && subscription.interval === interval
            return (
              <div key={id} className={cx('rounded-xl border p-4', current ? 'border-ink bg-raised' : 'border-line bg-raised/60')}>
                <div className="flex items-baseline justify-between">
                  <span className="font-serif text-lg font-medium">{plan.name}</span>
                  <span>
                    <span className="font-serif text-2xl font-medium">${plan.price![interval]}</span>
                    <span className="text-xs text-dim">/{interval}</span>
                  </span>
                </div>
                <p className="mt-1 text-sm text-dim">
                  {plan.lessons} lessons a month{plan.recordedVoices && ' · natural voices'}
                </p>
                <Button
                  variant={current ? 'secondary' : 'primary'}
                  className="mt-4 w-full justify-center"
                  disabled={current || busy !== null || blocked !== null}
                  onClick={() => choose(id)}
                >
                  {busy === id && <Loader2 className="size-4 animate-spin" />}
                  {current ? 'Current plan' : paying ? `Switch to ${plan.name}` : `Choose ${plan.name}`}
                </Button>
              </div>
            )
          })}
        </div>

        {!paying && (
          <label className="mt-4 flex items-center gap-3 text-sm">
            <span className="shrink-0 text-dim">Discount code</span>
            <input
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
              placeholder="Optional"
              className="h-9 w-40 rounded-lg border border-line-strong bg-raised px-3 tracking-wide uppercase outline-none focus:border-ink/50"
            />
          </label>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {paying && subscription.portalUrl && (
            <a href={subscription.portalUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                <CreditCard className="size-3.5" /> Payment details and invoices
              </Button>
            </a>
          )}
          {paying &&
            canManage &&
            (subscription.cancelAtPeriodEnd ? (
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => act('resume', api.resumePlan)}>
                Keep my subscription
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() =>
                  confirm(`Cancel your subscription? You keep ${PLANS[billing.plan].name} until ${formatDate(subscription.currentPeriodEnd)}.`) &&
                  act('cancel', api.cancelPlan)
                }
              >
                Cancel subscription
              </Button>
            ))}
          <span className="ml-auto text-xs text-faint">For schools and companies, ask us about Teams.</span>
        </div>
      </div>
    </div>
  )
}

function status(s: NonNullable<BillingSummary['subscription']>): string {
  if (s.status === 'past_due') return 'payment failed, please update your card'
  if (s.cancelAtPeriodEnd) return `ends on ${formatDate(s.currentPeriodEnd)}`
  if (s.scheduledPlan) return `changes to ${PLANS[s.scheduledPlan].name} on ${formatDate(s.currentPeriodEnd)}`
  return `${s.interval}ly, renews on ${formatDate(s.currentPeriodEnd)}`
}

export function UsageBar({ used, allowance, className }: { used: number; allowance: number; className?: string }) {
  const share = Math.min(1, used / allowance)
  return (
    <div className={className}>
      <div className="flex justify-between text-xs text-dim">
        <span>Lessons this month</span>
        <span className="tabular-nums">
          {used < 10 ? Math.round(used * 10) / 10 : Math.round(used)} of {allowance}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/10">
        <div className={cx('h-full rounded-full', share >= 1 ? 'bg-danger' : 'bg-accent')} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  )
}

