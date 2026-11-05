// Checks that the workspace's plan includes a feature (shared/plans.ts), for routes that need one.

import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { PLAN_ORDER, PLANS, type Feature } from '../shared/plans'
import type { Billing } from './billing/service'
import type { AppEnv } from './routes/context'

/** The cheapest plan that includes `feature`, for the upgrade message. */
export const planFor = (feature: Feature) => PLANS[PLAN_ORDER.find((id) => PLANS[id].allows.includes(feature))!]

export async function hasFeature(billing: Billing, workspaceId: string, feature: Feature): Promise<boolean> {
  return (await billing.entitlements(workspaceId)).features.includes(feature)
}

export function requireFeature(billing: Billing, feature: Feature, what: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!(await hasFeature(billing, c.var.account.workspaceId, feature))) {
      throw new HTTPException(402, { message: `${what} is part of the ${planFor(feature).name} plan. Upgrade to use it.` })
    }
    await next()
  })
}
