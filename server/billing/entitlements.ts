// What a workspace may do, from its subscription and usage. Pure functions, no I/O.

import { LESSON_TOKENS, PLAN_ORDER, PLANS, type Feature, type PlanId } from '../../shared/plans'
import type { Subscription } from './repo'

/** Statuses that keep paid access. `past_due` is the provider's retry window: a grace period. */
const ENTITLED = new Set(['trialing', 'active', 'past_due'])

/** The plan whose features apply right now. */
export function effectivePlan(subscription: Subscription | null, at = new Date()): PlanId {
  if (!subscription) return 'free'
  const time = at.toISOString()
  const paidUntil = subscription.currentPeriodEnd
  const entitled =
    ENTITLED.has(subscription.status) ||
    // Cancelled subscriptions keep access until the end of the period already paid for.
    (subscription.status === 'cancelled' && paidUntil !== null && time < paidUntil)
  if (!entitled) return 'free'
  // After a downgrade the customer keeps the higher plan they paid for until the period ends.
  const previous = subscription.previousPlan
  if (previous && subscription.previousPlanUntil && time < subscription.previousPlanUntil) {
    return PLAN_ORDER.indexOf(previous) > PLAN_ORDER.indexOf(subscription.plan) ? previous : subscription.plan
  }
  return subscription.plan
}

/** Usage resets each calendar month (UTC), for monthly and yearly plans alike. */
export function periodStart(at = new Date()): string {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString()
}

export interface Entitlements {
  plan: PlanId
  tokenAllowance: number
  tokensUsed: number
  /** Generation is allowed while any allowance is left; the request in flight may finish over it. */
  canGenerate: boolean
  /** What the plan unlocks beyond lessons and seats. */
  features: Feature[]
}

export function entitlements(plan: PlanId, tokensUsed: number): Entitlements {
  const tokenAllowance = PLANS[plan].lessons * LESSON_TOKENS
  return { plan, tokenAllowance, tokensUsed, canGenerate: tokensUsed < tokenAllowance, features: PLANS[plan].allows }
}
