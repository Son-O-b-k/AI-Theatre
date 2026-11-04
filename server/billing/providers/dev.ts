// A stand-in payment service for development and tests: no money moves. Checkout completes
// instantly at /api/billing/dev/checkout/:id, and every change is delivered as a signed webhook
// through the same path a real provider uses, so the billing core is exercised end to end.

import { createHmac, randomBytes } from 'node:crypto'
import type { Interval } from '../../../shared/plans'
import { newId } from '../../db'
import type { BillingEvent, BillingProvider, CheckoutRequest, PlanChange, ProviderSubscription } from '../types'

const DAY = 86_400_000

export class DevBillingProvider implements BillingProvider {
  readonly id = 'dev'
  private readonly secret = randomBytes(16).toString('hex')
  private readonly pending = new Map<string, CheckoutRequest>()
  private readonly subscriptions = new Map<string, ProviderSubscription>()
  /** Set by the server: hands a webhook to the billing core, as an HTTP call would. */
  deliver: (rawBody: string, headers: Headers) => Promise<unknown> = async () => {}

  async createCheckout(request: CheckoutRequest): Promise<{ url: string }> {
    this.pending.set(request.checkoutId, request)
    return { url: `/api/billing/dev/checkout/${request.checkoutId}` }
  }

  /** What the hosted payment page would do once the customer pays. */
  async completeCheckout(checkoutId: string): Promise<void> {
    const request = this.pending.get(checkoutId)
    if (!request) throw new Error(`No pending checkout ${checkoutId}`)
    this.pending.delete(checkoutId)
    const subscription: ProviderSubscription = {
      provider: this.id,
      providerSubscriptionId: newId(),
      customerId: request.email,
      plan: request.plan,
      interval: request.interval,
      status: 'active',
      currentPeriodEnd: periodEnd(request.interval),
      cancelAtPeriodEnd: false,
      workspaceId: request.workspaceId,
      checkoutId: request.checkoutId,
    }
    await this.update(subscription)
  }

  async changePlan(id: string, change: PlanChange): Promise<void> {
    const current = this.require(id)
    // A real provider would charge the difference now for `immediately`; nothing moves here.
    await this.update({ ...current, plan: change.plan, interval: change.interval })
  }

  async cancel(id: string): Promise<void> {
    await this.update({ ...this.require(id), cancelAtPeriodEnd: true, status: 'cancelled' })
  }

  async resume(id: string): Promise<void> {
    await this.update({ ...this.require(id), cancelAtPeriodEnd: false, status: 'active' })
  }

  /** Test helper: the renewal charge fails, then (optionally) the period lapses. */
  async simulate(id: string, what: 'payment_failed' | 'expired' | 'renewed'): Promise<void> {
    const current = this.require(id)
    if (what === 'payment_failed') await this.update({ ...current, status: 'past_due' }, 'payment.failed')
    if (what === 'expired') await this.update({ ...current, status: 'expired' })
    if (what === 'renewed') await this.update({ ...current, status: 'active', currentPeriodEnd: periodEnd(current.interval, current.currentPeriodEnd) })
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<BillingEvent> {
    if (headers.get('x-dev-signature') !== this.sign(rawBody)) throw new Error('Invalid webhook signature')
    return JSON.parse(rawBody) as BillingEvent
  }

  private async update(subscription: ProviderSubscription, type: BillingEvent['type'] = 'subscription.updated'): Promise<void> {
    this.subscriptions.set(subscription.providerSubscriptionId, subscription)
    const body = JSON.stringify({ id: newId(), type, subscription } satisfies BillingEvent)
    await this.deliver(body, new Headers({ 'x-dev-signature': this.sign(body) }))
  }

  private require(id: string): ProviderSubscription {
    const subscription = this.subscriptions.get(id)
    if (!subscription) throw new Error(`Unknown dev subscription ${id} (dev subscriptions do not survive a restart)`)
    return subscription
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex')
  }
}

function periodEnd(interval: Interval, from?: string): string {
  const start = from ? Date.parse(from) : Date.now()
  return new Date(start + (interval === 'year' ? 365 : 30) * DAY).toISOString()
}
