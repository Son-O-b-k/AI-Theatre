import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { DevBillingProvider } from '../billing/providers/dev'
import { BillingError } from '../billing/service'
import { requireAccount, siteUrl, type AppEnv, type Deps } from './context'

const PlanChoice = z.object({
  plan: z.enum(['creator', 'pro']),
  interval: z.enum(['month', 'year']),
})

export function billingRoutes({ db, billing }: Deps) {
  const app = new Hono<AppEnv>()
  const signedIn = requireAccount(db)
  /** Only the workspace owner buys, changes or cancels its plan. */
  const owner = createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.account.role !== 'owner') throw new BillingError('Only the workspace owner can manage the plan.', 403)
    await next()
  })

  // Called by the payment service, not the browser: authenticated by its signature instead.
  app.post('/webhook', async (c) => {
    try {
      await billing.handleWebhook(await c.req.text(), c.req.raw.headers)
    } catch (error) {
      console.warn('Billing webhook rejected:', error instanceof Error ? error.message : error)
      throw new HTTPException(400, { message: 'Invalid webhook' })
    }
    return c.json({ ok: true })
  })

  app.get('/', signedIn, async (c) => c.json(await billing.summary(c.var.account.workspaceId)))

  app.post('/checkout', signedIn, owner, async (c) => {
    const { plan, interval, discountCode } = PlanChoice.extend({ discountCode: z.string().max(64).optional() }).parse(await c.req.json())
    return c.json(await billing.checkout(c.var.account, plan, interval, `${siteUrl(c)}/app?billing=success`, discountCode))
  })

  app.post('/change', signedIn, owner, async (c) => {
    const { plan, interval } = PlanChoice.parse(await c.req.json())
    await billing.changePlan(c.var.account.workspaceId, plan, interval)
    return c.json(await billing.summary(c.var.account.workspaceId))
  })

  app.post('/cancel', signedIn, owner, async (c) => {
    await billing.cancel(c.var.account.workspaceId)
    return c.json(await billing.summary(c.var.account.workspaceId))
  })

  app.post('/resume', signedIn, owner, async (c) => {
    await billing.resume(c.var.account.workspaceId)
    return c.json(await billing.summary(c.var.account.workspaceId))
  })

  // The dev provider's stand-in for a hosted payment page: completes the checkout and returns.
  const { provider } = billing
  if (provider instanceof DevBillingProvider) {
    app.get('/dev/checkout/:id', signedIn, async (c) => {
      await provider.completeCheckout(c.req.param('id'))
      return c.redirect('/app?billing=success')
    })
  }

  return app
}
