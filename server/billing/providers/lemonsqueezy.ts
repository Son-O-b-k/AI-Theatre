// Lemon Squeezy adapter. Lemon Squeezy is the merchant of record: it charges cards, handles tax,
// invoices, retries, discount codes and the customer portal. API: https://docs.lemonsqueezy.com/api

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { Interval, PlanId } from '../../../shared/plans'
import { request } from '../../providers/http'
import type { BillingEvent, BillingProvider, CheckoutRequest, PlanChange, ProviderSubscription, SubscriptionStatus } from '../types'

const API = 'https://api.lemonsqueezy.com/v1'

export interface LemonSqueezyConfig {
  apiKey: string
  storeId: string
  webhookSecret: string
  /** Variant id for each sellable plan and interval, e.g. { "creator:month": "123456" }. */
  variants: Record<string, string>
}

const STATUSES: Record<string, SubscriptionStatus> = {
  on_trial: 'trialing',
  active: 'active',
  past_due: 'past_due',
  // Retries failed: no access until the customer pays.
  unpaid: 'paused',
  paused: 'paused',
  cancelled: 'cancelled',
  expired: 'expired',
}

interface SubscriptionAttributes {
  customer_id: number
  variant_id: number
  status: string
  cancelled: boolean
  renews_at: string | null
  ends_at: string | null
  urls?: { customer_portal?: string }
}

export class LemonSqueezyProvider implements BillingProvider {
  readonly id = 'lemonsqueezy'
  private readonly plans: Map<string, { plan: PlanId; interval: Interval }>

  constructor(private readonly config: LemonSqueezyConfig) {
    this.plans = new Map(
      Object.entries(config.variants).map(([key, variant]) => {
        const [plan, interval] = key.split(':') as [PlanId, Interval]
        return [String(variant), { plan, interval }]
      }),
    )
  }

  async createCheckout(r: CheckoutRequest): Promise<{ url: string }> {
    const variant = this.variant(r.plan, r.interval)
    const body = {
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: r.email,
            ...(r.discountCode && { discount_code: r.discountCode }),
            // Comes back in every webhook for this subscription as meta.custom_data.
            custom: { workspace_id: r.workspaceId, checkout_id: r.checkoutId },
          },
          product_options: { redirect_url: r.returnUrl, enabled_variants: [Number(variant)] },
        },
        relationships: {
          store: { data: { type: 'stores', id: this.config.storeId } },
          variant: { data: { type: 'variants', id: variant } },
        },
      },
    }
    const response = await this.call('POST', '/checkouts', body)
    return { url: response.data.attributes.url }
  }

  async changePlan(id: string, change: PlanChange): Promise<void> {
    await this.call('PATCH', `/subscriptions/${id}`, {
      data: {
        type: 'subscriptions',
        id,
        attributes: {
          variant_id: Number(this.variant(change.plan, change.interval)),
          // Upgrades: bill the prorated difference now. Downgrades: switch price with no proration.
          invoice_immediately: change.proration === 'immediately',
          disable_prorations: change.proration === 'none',
        },
      },
    })
  }

  async cancel(id: string): Promise<void> {
    // Lemon Squeezy cancels at the end of the billing period.
    await this.call('DELETE', `/subscriptions/${id}`)
  }

  async resume(id: string): Promise<void> {
    await this.call('PATCH', `/subscriptions/${id}`, { data: { type: 'subscriptions', id, attributes: { cancelled: false } } })
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<BillingEvent> {
    const signature = Buffer.from(headers.get('x-signature') ?? '', 'hex')
    const expected = createHmac('sha256', this.config.webhookSecret).update(rawBody).digest()
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error('Invalid webhook signature')

    const payload = JSON.parse(rawBody)
    // Lemon Squeezy sends no event id; a retry repeats the same body, so its hash identifies it.
    const id = createHash('sha256').update(rawBody).digest('hex')
    const name: string = payload.meta?.event_name ?? headers.get('x-event-name') ?? ''

    // Payment events carry invoices, not subscriptions. Every change they cause (past_due, active
    // again, new period) also arrives as subscription_updated, which is what we apply.
    if (!name.startsWith('subscription_') || payload.data?.type !== 'subscriptions') return { id, type: 'ignored' }

    const attributes = payload.data.attributes as SubscriptionAttributes
    const plan = this.plans.get(String(attributes.variant_id))
    if (!plan) {
      console.warn(`Lemon Squeezy: variant ${attributes.variant_id} is not in billing.json`)
      return { id, type: 'ignored' }
    }
    const custom = payload.meta?.custom_data ?? {}
    const subscription: ProviderSubscription = {
      provider: this.id,
      providerSubscriptionId: String(payload.data.id),
      customerId: String(attributes.customer_id),
      ...plan,
      status: STATUSES[attributes.status] ?? 'paused',
      currentPeriodEnd: (attributes.cancelled ? attributes.ends_at : attributes.renews_at) ?? undefined,
      cancelAtPeriodEnd: attributes.cancelled,
      portalUrl: attributes.urls?.customer_portal,
      workspaceId: custom.workspace_id,
      checkoutId: custom.checkout_id,
    }
    return { id, type: 'subscription.updated', subscription }
  }

  private variant(plan: PlanId, interval: Interval): string {
    const variant = this.config.variants[`${plan}:${interval}`]
    if (!variant) throw new Error(`No Lemon Squeezy variant for ${plan}:${interval} in billing.json`)
    return variant
  }

  private async call(method: string, path: string, body?: unknown) {
    const response = await request(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return response.status === 204 ? null : response.json()
  }
}
