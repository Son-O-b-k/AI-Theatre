// The contract between the billing core and a payment service. The core never sees a provider's
// own formats: an adapter turns checkouts, plan changes and webhooks into these shapes.
// Supporting another service (Paddle, Paystack, Stripe...) means writing one adapter.

import type { Interval, PlanId } from '../../shared/plans'

/** Normalized subscription states. Adapters map their provider's states onto these. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired'

/** A subscription as the provider reports it. */
export interface ProviderSubscription {
  provider: string
  providerSubscriptionId: string
  customerId?: string
  plan: PlanId
  interval: Interval
  status: SubscriptionStatus
  /** When the paid period ends (renews, or ends if cancelled). */
  currentPeriodEnd?: string
  /** Cancelled by the customer; access continues until currentPeriodEnd. */
  cancelAtPeriodEnd: boolean
  /** Where the customer manages cards, invoices and cancellation, if the provider offers it. */
  portalUrl?: string
  /** Ours, passed through checkout: which workspace and checkout this belongs to. */
  workspaceId?: string
  checkoutId?: string
}

/** A verified webhook, normalized. `id` makes handling idempotent. */
export interface BillingEvent {
  id: string
  type: 'subscription.updated' | 'payment.failed' | 'payment.succeeded' | 'ignored'
  subscription?: ProviderSubscription
}

export interface CheckoutRequest {
  checkoutId: string
  workspaceId: string
  email: string
  plan: PlanId
  interval: Interval
  discountCode?: string
  /** Where the customer returns after paying. */
  returnUrl: string
}

export interface PlanChange {
  plan: PlanId
  interval: Interval
  /**
   * `immediately`: charge the prorated difference now (upgrades).
   * `none`: switch the price without charging or crediting; the new price applies from the next renewal (downgrades).
   */
  proration: 'immediately' | 'none'
}

export interface BillingProvider {
  readonly id: string
  /** A hosted payment page for a new subscription. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string }>
  changePlan(providerSubscriptionId: string, change: PlanChange): Promise<void>
  /** Cancels at the end of the paid period. */
  cancel(providerSubscriptionId: string): Promise<void>
  /** Undoes a cancellation before the period ends. */
  resume(providerSubscriptionId: string): Promise<void>
  /** Verifies the signature and normalizes the payload; throws if the signature is wrong. */
  parseWebhook(rawBody: string, headers: Headers): Promise<BillingEvent>
}
