// Billing records in the database. The only billing module that knows SQL.

import type { Interval, PlanId } from '../../shared/plans'
import { newId, now, type Db } from '../db'
import type { SubscriptionStatus } from './types'

/** Our copy of a workspace's subscription. */
export interface Subscription {
  workspaceId: string
  provider: string
  providerSubscriptionId: string
  customerId: string | null
  plan: PlanId
  interval: Interval
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** After a downgrade, the plan paid for until `previousPlanUntil`. */
  previousPlan: PlanId | null
  previousPlanUntil: string | null
  discountCode: string | null
  portalUrl: string | null
  /** Seats bought, for Teams contracts; otherwise the plan's own count applies. */
  seats: number | null
}

interface Row {
  workspace_id: string
  provider: string
  provider_subscription_id: string
  customer_id: string | null
  plan: string
  interval: string
  status: string
  current_period_end: string | null
  cancel_at_period_end: number
  previous_plan: string | null
  previous_plan_until: string | null
  discount_code: string | null
  portal_url: string | null
  seats: number | null
}

const fromRow = (row: Row): Subscription => ({
  workspaceId: row.workspace_id,
  provider: row.provider,
  providerSubscriptionId: row.provider_subscription_id,
  customerId: row.customer_id,
  plan: row.plan as PlanId,
  interval: row.interval as Interval,
  status: row.status as SubscriptionStatus,
  currentPeriodEnd: row.current_period_end,
  cancelAtPeriodEnd: row.cancel_at_period_end === 1,
  previousPlan: row.previous_plan as PlanId | null,
  previousPlanUntil: row.previous_plan_until,
  discountCode: row.discount_code,
  portalUrl: row.portal_url,
  seats: row.seats === null ? null : Number(row.seats),
})

export async function subscriptionFor(db: Db, workspaceId: string): Promise<Subscription | null> {
  const row = await db.get<Row>('SELECT * FROM subscriptions WHERE workspace_id = ?', workspaceId)
  return row ? fromRow(row) : null
}

export async function subscriptionByProviderId(db: Db, provider: string, id: string): Promise<Subscription | null> {
  const row = await db.get<Row>('SELECT * FROM subscriptions WHERE provider = ? AND provider_subscription_id = ?', provider, id)
  return row ? fromRow(row) : null
}

export async function saveSubscription(db: Db, s: Subscription): Promise<void> {
  await db.run(
    `INSERT INTO subscriptions (workspace_id, provider, provider_subscription_id, customer_id, plan, interval, status,
       current_period_end, cancel_at_period_end, previous_plan, previous_plan_until, discount_code, portal_url, seats, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET
       provider = excluded.provider, provider_subscription_id = excluded.provider_subscription_id,
       customer_id = excluded.customer_id, plan = excluded.plan, interval = excluded.interval, status = excluded.status,
       current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
       previous_plan = excluded.previous_plan, previous_plan_until = excluded.previous_plan_until,
       discount_code = excluded.discount_code, portal_url = excluded.portal_url, seats = excluded.seats,
       updated_at = excluded.updated_at`,
    s.workspaceId, s.provider, s.providerSubscriptionId, s.customerId, s.plan, s.interval, s.status, s.currentPeriodEnd,
    s.cancelAtPeriodEnd ? 1 : 0, s.previousPlan, s.previousPlanUntil, s.discountCode, s.portalUrl, s.seats, now(),
  )
}

// Checkouts started from the app, so a new subscription can be tied back to its workspace and discount.

export interface Checkout {
  id: string
  workspaceId: string
  plan: PlanId
  interval: Interval
  discountCode: string | null
}

export async function createCheckout(db: Db, workspaceId: string, plan: PlanId, interval: Interval, discountCode?: string): Promise<Checkout> {
  const checkout = { id: newId(), workspaceId, plan, interval, discountCode: discountCode ?? null }
  await db.run(
    'INSERT INTO checkouts (id, workspace_id, plan, interval, discount_code, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    checkout.id, workspaceId, plan, interval, checkout.discountCode, now(),
  )
  return checkout
}

export async function checkoutById(db: Db, id: string): Promise<Checkout | null> {
  const row = await db.get<{ id: string; workspace_id: string; plan: string; interval: string; discount_code: string | null }>(
    'SELECT id, workspace_id, plan, interval, discount_code FROM checkouts WHERE id = ?',
    id,
  )
  return row
    ? { id: row.id, workspaceId: row.workspace_id, plan: row.plan as PlanId, interval: row.interval as Interval, discountCode: row.discount_code }
    : null
}

/** Records a webhook; false if it was already handled (providers retry and may send twice). */
export async function recordEvent(db: Db, provider: string, id: string, type: string): Promise<boolean> {
  const changed = await db.run(
    'INSERT INTO billing_events (id, provider, type, received_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    `${provider}:${id}`, provider, type, now(),
  )
  return changed === 1
}

// Usage, in AI tokens.

export async function recordUsage(db: Db, workspaceId: string, kind: string, tokens: number): Promise<void> {
  await db.run('INSERT INTO usage (workspace_id, kind, tokens, created_at) VALUES (?, ?, ?, ?)', workspaceId, kind, Math.round(tokens), now())
}

/** Usage on a workspace's own AI provider: recorded, but not counted against the allowance. */
export const OWN_KEY_USAGE = 'own-key'

export async function tokensUsedSince(db: Db, workspaceId: string, since: string): Promise<number> {
  const row = await db.get<{ total: number | string }>(
    'SELECT COALESCE(SUM(tokens), 0) AS total FROM usage WHERE workspace_id = ? AND created_at >= ? AND kind <> ?',
    workspaceId,
    since,
    OWN_KEY_USAGE,
  )
  return Number(row?.total ?? 0) // Postgres returns sums as text (bigint)
}

export async function workspaceExists(db: Db, id: string): Promise<boolean> {
  return Boolean(await db.get('SELECT 1 FROM workspaces WHERE id = ?', id))
}
