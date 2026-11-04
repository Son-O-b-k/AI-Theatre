// Run with `npm test`. The billing core against the dev provider (signed webhooks, no money),
// plus the Lemon Squeezy adapter's webhook handling.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { LESSON_TOKENS } from '../../shared/plans'
import { markVerified, signUp, type Account } from '../accounts'
import { setManualPlan } from '../admin'
import type { Db } from '../db'
import { freshDb } from '../test-db'
import { DevBillingProvider } from './providers/dev'
import { LemonSqueezyProvider } from './providers/lemonsqueezy'
import { subscriptionFor } from './repo'
import { Billing, BillingError } from './service'

const later = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000)

describe('billing', () => {
  let db: Db
  let provider: DevBillingProvider
  let billing: Billing
  let account: Account

  beforeEach(async () => {
    db = await freshDb()
    provider = new DevBillingProvider()
    billing = new Billing(db, provider)
    provider.deliver = (body, headers) => billing.handleWebhook(body, headers)
    account = await signUp(db, 'Teacher@Example.com', 'correct horse battery')
    await markVerified(db, account.userId)
    account = { ...account, emailVerified: true }
  })

  afterEach(() => db.close())

  /** Checks out and pays, as the hosted checkout page would. */
  async function subscribe(plan: 'creator' | 'pro', interval: 'month' | 'year' = 'month', code?: string) {
    const { url } = await billing.checkout(account, plan, interval, '/app', code)
    await provider.completeCheckout(url.split('/checkout/')[1])
    return (await subscriptionFor(db, account.workspaceId))!
  }

  test('a new workspace is on Free and stops generating when its allowance is used', async () => {
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'free')
    assert.equal((await billing.entitlements(account.workspaceId)).recordedVoices, false)
    await billing.recordUsage(account.workspaceId, 'chat', 3 * LESSON_TOKENS)
    assert.equal((await billing.entitlements(account.workspaceId)).canGenerate, false)
  })

  test('checkout creates the subscription from the webhook, with its discount code', async () => {
    const s = await subscribe('creator', 'month', ' launch50 ')
    assert.equal(s.plan, 'creator')
    assert.equal(s.discountCode, 'LAUNCH50')
    const e = (await billing.entitlements(account.workspaceId))
    assert.deepEqual([e.plan, e.recordedVoices, e.tokenAllowance], ['creator', true, 30 * LESSON_TOKENS])
  })

  test('checkout needs a confirmed email and is for owners of free workspaces', async () => {
    await assert.rejects(billing.checkout({ ...account, emailVerified: false }, 'creator', 'month', '/app'), /confirm your email/)
  })

  test('an invoiced plan cannot be changed through the payment service', async () => {
    await setManualPlan(db, account.workspaceId, 'teams', 10, later(new Date().toISOString(), 365))
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'teams')
    await assert.rejects(billing.changePlan(account.workspaceId, 'pro', 'month'), /managed by invoice/)
  })

  test('only free workspaces check out, and Teams is not sold online', async () => {
    await assert.rejects(billing.checkout(account, 'teams', 'month', '/app'), BillingError)
    await subscribe('creator')
    await assert.rejects(billing.checkout(account, 'pro', 'month', '/app'), /change its plan/)
  })

  test('an upgrade applies at once', async () => {
    await subscribe('creator')
    await billing.changePlan(account.workspaceId, 'pro', 'month')
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'pro')
    assert.equal((await billing.summary(account.workspaceId)).subscription?.scheduledPlan, null)
  })

  test('a downgrade keeps the paid plan until the period ends, then switches', async () => {
    const { currentPeriodEnd } = await subscribe('pro')
    await billing.changePlan(account.workspaceId, 'creator', 'month')
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'pro')
    assert.equal((await billing.summary(account.workspaceId)).subscription?.scheduledPlan, 'creator')
    assert.equal((await billing.entitlements(account.workspaceId, later(currentPeriodEnd!, 1))).plan, 'creator')

    // The renewal webhook (a later period) clears the kept plan for good.
    await provider.simulate((await subscriptionFor(db, account.workspaceId))!.providerSubscriptionId, 'renewed')
    assert.equal((await subscriptionFor(db, account.workspaceId))?.previousPlan, null)
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'creator')
  })

  test('an upgrade during a pending downgrade cancels the downgrade', async () => {
    await subscribe('pro')
    await billing.changePlan(account.workspaceId, 'creator', 'month')
    await billing.changePlan(account.workspaceId, 'pro', 'month')
    assert.equal((await subscriptionFor(db, account.workspaceId))?.previousPlan, null)
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'pro')
  })

  test('cancelling keeps access until the period ends; resuming undoes it', async () => {
    const { currentPeriodEnd } = await subscribe('creator')
    await billing.cancel(account.workspaceId)
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'creator')
    assert.equal((await billing.entitlements(account.workspaceId, later(currentPeriodEnd!, 1))).plan, 'free')
    await billing.resume(account.workspaceId)
    assert.equal((await billing.summary(account.workspaceId)).subscription?.cancelAtPeriodEnd, false)
    assert.equal((await billing.entitlements(account.workspaceId, later(currentPeriodEnd!, 1))).plan, 'creator')
  })

  test('a failed payment is a grace period; expiry ends access', async () => {
    const { providerSubscriptionId } = await subscribe('creator')
    await provider.simulate(providerSubscriptionId, 'payment_failed')
    assert.equal((await subscriptionFor(db, account.workspaceId))?.status, 'past_due')
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'creator')
    await provider.simulate(providerSubscriptionId, 'expired')
    assert.equal((await billing.entitlements(account.workspaceId)).plan, 'free')
  })

  test('a repeated webhook is applied once, and a forged one is rejected', async () => {
    let delivery: [string, Headers] | null = null
    provider.deliver = async (body, headers) => {
      delivery = [body, headers]
      return billing.handleWebhook(body, headers)
    }
    await subscribe('creator')
    const [body, headers] = delivery!
    assert.equal(await billing.handleWebhook(body, headers), false)
    await assert.rejects(billing.handleWebhook(body.replace('creator', 'pro'), headers), /signature/)
  })
})

describe('Lemon Squeezy webhooks', () => {
  const provider = new LemonSqueezyProvider({
    apiKey: 'test',
    storeId: '1',
    webhookSecret: 'whsec',
    variants: { 'creator:month': '101', 'pro:year': '202' },
  })
  const signed = (payload: object) => {
    const body = JSON.stringify(payload)
    return [body, new Headers({ 'x-signature': createHmac('sha256', 'whsec').update(body).digest('hex') })] as const
  }
  const subscriptionEvent = (attributes: object) => ({
    meta: { event_name: 'subscription_updated', custom_data: { workspace_id: 'w1', checkout_id: 'c1' } },
    data: {
      type: 'subscriptions',
      id: '999',
      attributes: { customer_id: 7, variant_id: 202, status: 'active', cancelled: false, renews_at: '2027-06-01T00:00:00Z', ends_at: null, urls: { customer_portal: 'https://portal' }, ...attributes },
    },
  })

  test('a subscription event is verified and normalized', async () => {
    const event = await provider.parseWebhook(...signed(subscriptionEvent({})))
    assert.equal(event.type, 'subscription.updated')
    assert.deepEqual(event.subscription, {
      provider: 'lemonsqueezy',
      providerSubscriptionId: '999',
      customerId: '7',
      plan: 'pro',
      interval: 'year',
      status: 'active',
      currentPeriodEnd: '2027-06-01T00:00:00Z',
      cancelAtPeriodEnd: false,
      portalUrl: 'https://portal',
      workspaceId: 'w1',
      checkoutId: 'c1',
    })
  })

  test('a cancelled subscription runs to its end date', async () => {
    const event = await provider.parseWebhook(...signed(subscriptionEvent({ status: 'cancelled', cancelled: true, ends_at: '2027-05-01T00:00:00Z' })))
    assert.equal(event.subscription?.currentPeriodEnd, '2027-05-01T00:00:00Z')
    assert.equal(event.subscription?.cancelAtPeriodEnd, true)
  })

  test('a bad signature is rejected; invoices and unknown variants are ignored', async () => {
    const [body] = signed(subscriptionEvent({}))
    await assert.rejects(provider.parseWebhook(body, new Headers({ 'x-signature': 'ab'.repeat(32) })), /signature/)
    const invoice = { meta: { event_name: 'subscription_payment_failed' }, data: { type: 'subscription-invoices', id: '5', attributes: {} } }
    assert.equal((await provider.parseWebhook(...signed(invoice))).type, 'ignored')
    assert.equal((await provider.parseWebhook(...signed(subscriptionEvent({ variant_id: 303 })))).type, 'ignored')
  })
})
