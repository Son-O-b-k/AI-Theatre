// The billing core: checkout, plan changes with proration, cancellation, webhooks and usage.
// It talks to a payment service only through BillingProvider (./types.ts) and to the database
// only through ./repo.ts.

import { isUpgrade, PLANS, type Interval, type PlanId } from '../../shared/plans'
import type { BillingSummary } from '../../shared/protocol'
import type { Account } from '../accounts'
import type { Db } from '../db'
import { effectivePlan, entitlements, periodStart, type Entitlements } from './entitlements'
import * as repo from './repo'
import type { BillingEvent, BillingProvider, ProviderSubscription } from './types'

export class BillingError extends Error {
  constructor(message: string, readonly status: 400 | 402 | 403 | 404 | 409 = 400) {
    super(message)
  }
}

export class Billing {
  constructor(
    private readonly db: Db,
    readonly provider: BillingProvider,
  ) {}

  async entitlements(workspaceId: string, at = new Date()): Promise<Entitlements> {
    const plan = effectivePlan(await repo.subscriptionFor(this.db, workspaceId), at)
    return entitlements(plan, await repo.tokensUsedSince(this.db, workspaceId, periodStart(at)))
  }

  async summary(workspaceId: string): Promise<BillingSummary> {
    const s = await repo.subscriptionFor(this.db, workspaceId)
    const current = await this.entitlements(workspaceId)
    return {
      ...current,
      subscription: s && {
        plan: s.plan,
        interval: s.interval,
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        scheduledPlan: s.previousPlan && current.plan === s.previousPlan ? s.plan : null,
        discountCode: s.discountCode,
        portalUrl: s.portalUrl,
      },
    }
  }

  recordUsage(workspaceId: string, kind: string, tokens: number): Promise<void> {
    return repo.recordUsage(this.db, workspaceId, kind, tokens)
  }

  /** Starts a new subscription. Workspaces that already pay change plan instead. */
  async checkout(account: Account, plan: PlanId, interval: Interval, returnUrl: string, discountCode?: string): Promise<{ url: string }> {
    if (!PLANS[plan].selfServe) throw new BillingError(`${PLANS[plan].name} is not sold online.`)
    // Receipts and payment problems go to this address, so it must be a real one.
    if (!account.emailVerified) throw new BillingError('Please confirm your email address first; we sent you a link.', 403)
    if (effectivePlan(await repo.subscriptionFor(this.db, account.workspaceId)) !== 'free') {
      throw new BillingError('This workspace already has a subscription; change its plan instead.', 409)
    }
    const code = discountCode?.trim().toUpperCase() || undefined
    const checkout = await repo.createCheckout(this.db, account.workspaceId, plan, interval, code)
    return this.provider.createCheckout({
      checkoutId: checkout.id,
      workspaceId: account.workspaceId,
      email: account.email,
      plan,
      interval,
      discountCode: code,
      returnUrl,
    })
  }

  /**
   * Upgrades take effect now and charge the prorated difference. Downgrades switch the price
   * without a charge or credit, and the customer keeps the higher plan until the paid period ends.
   */
  async changePlan(workspaceId: string, plan: PlanId, interval: Interval): Promise<void> {
    const s = await this.requireSubscription(workspaceId)
    if (!PLANS[plan].selfServe) throw new BillingError(`${PLANS[plan].name} is not sold online.`)
    if (s.plan === plan && s.interval === interval) return

    const upgrade = isUpgrade(s.plan, plan) || (s.plan === plan && interval === 'year')
    await this.provider.changePlan(s.providerSubscriptionId, { plan, interval, proration: upgrade ? 'immediately' : 'none' })

    // Keep the higher plan for the rest of the period on a downgrade; an upgrade clears any earlier one.
    const keepPrevious = !upgrade && isUpgrade(plan, s.plan)
    await repo.saveSubscription(this.db, {
      ...(await this.latest(s)),
      plan,
      interval,
      previousPlan: keepPrevious ? s.plan : null,
      previousPlanUntil: keepPrevious ? s.currentPeriodEnd : null,
    })
  }

  async cancel(workspaceId: string): Promise<void> {
    const s = await this.requireSubscription(workspaceId)
    await this.provider.cancel(s.providerSubscriptionId)
    await repo.saveSubscription(this.db, { ...(await this.latest(s)), cancelAtPeriodEnd: true })
  }

  async resume(workspaceId: string): Promise<void> {
    const s = await this.requireSubscription(workspaceId)
    await this.provider.resume(s.providerSubscriptionId)
    const latest = await this.latest(s)
    await repo.saveSubscription(this.db, { ...latest, cancelAtPeriodEnd: false, status: latest.status === 'cancelled' ? 'active' : latest.status })
  }

  /**
   * Verifies, de-duplicates and applies a webhook in one transaction, so an event that fails
   * half-way is not marked as handled and the provider's retry gets another chance.
   * Returns false for a repeat delivery.
   */
  async handleWebhook(rawBody: string, headers: Headers): Promise<boolean> {
    const event = await this.provider.parseWebhook(rawBody, headers)
    return this.db.transaction(async (tx) => {
      if (!(await repo.recordEvent(tx, this.provider.id, event.id, event.type))) return false
      await apply(tx, event)
      return true
    })
  }

  /** A provider may deliver a webhook while a call is in flight; build on what it wrote. */
  private async latest(s: repo.Subscription): Promise<repo.Subscription> {
    return (await repo.subscriptionFor(this.db, s.workspaceId)) ?? s
  }

  private async requireSubscription(workspaceId: string): Promise<repo.Subscription> {
    const s = await repo.subscriptionFor(this.db, workspaceId)
    if (!s || effectivePlan(s) === 'free') throw new BillingError('This workspace has no active subscription.', 404)
    // Plans sold by invoice (scripts/admin.ts) are changed by us, not through the payment service.
    if (s.provider !== this.provider.id) throw new BillingError('This plan is managed by invoice. Contact us to change it.', 409)
    return s
  }
}

async function apply(db: Db, event: BillingEvent): Promise<void> {
  if (event.type === 'ignored' || !event.subscription) return
  const incoming = event.subscription
  const existing = await repo.subscriptionByProviderId(db, incoming.provider, incoming.providerSubscriptionId)
  const workspaceId = existing?.workspaceId ?? (await workspaceFor(db, incoming))
  if (!workspaceId) {
    console.warn(`Billing: no workspace for ${incoming.provider} subscription ${incoming.providerSubscriptionId}`)
    return
  }
  const checkout = incoming.checkoutId ? await repo.checkoutById(db, incoming.checkoutId) : null
  // A downgrade's kept plan expires with the period it was paid for.
  const renewed = existing?.previousPlanUntil && incoming.currentPeriodEnd && incoming.currentPeriodEnd > existing.previousPlanUntil
  await repo.saveSubscription(db, {
    workspaceId,
    provider: incoming.provider,
    providerSubscriptionId: incoming.providerSubscriptionId,
    customerId: incoming.customerId ?? existing?.customerId ?? null,
    plan: incoming.plan,
    interval: incoming.interval,
    status: event.type === 'payment.failed' && incoming.status === 'active' ? 'past_due' : incoming.status,
    currentPeriodEnd: incoming.currentPeriodEnd ?? existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: incoming.cancelAtPeriodEnd,
    previousPlan: renewed ? null : (existing?.previousPlan ?? null),
    previousPlanUntil: renewed ? null : (existing?.previousPlanUntil ?? null),
    discountCode: existing?.discountCode ?? checkout?.discountCode ?? null,
    portalUrl: incoming.portalUrl ?? existing?.portalUrl ?? null,
    seats: existing?.seats ?? null,
  })
}

async function workspaceFor(db: Db, incoming: ProviderSubscription): Promise<string | null> {
  if (incoming.workspaceId && (await repo.workspaceExists(db, incoming.workspaceId))) return incoming.workspaceId
  if (incoming.checkoutId) return (await repo.checkoutById(db, incoming.checkoutId))?.workspaceId ?? null
  return null
}
