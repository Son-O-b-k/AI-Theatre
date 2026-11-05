// What every route module shares: dependencies, the signed-in account, and the session check.

import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { accountForSession, type Account } from '../accounts'
import type { Billing } from '../billing/service'
import type { Db } from '../db'
import type { Mailer } from '../email'
import type { Provider } from '../providers/types'

export interface Deps {
  db: Db
  billing: Billing
  providers: Map<string, Provider>
  mailer: Mailer
}

export type AppEnv = { Variables: { account: Account } }

export const SESSION_COOKIE = 'session'

/** The site's address for links in emails: PUBLIC_URL, else where the request came from. */
export function siteUrl(c: Context): string {
  return (process.env.PUBLIC_URL ?? c.req.header('origin') ?? new URL(c.req.url).origin).replace(/\/$/, '')
}

/** Rejects requests without a valid session; otherwise exposes the account as c.var.account. */
export function requireAccount(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    const account = token ? await accountForSession(db, token) : null
    if (!account) throw new HTTPException(401, { message: 'Please sign in.' })
    c.set('account', account)
    await next()
  }
}

/** After requireAccount: only the workspace owner may continue. */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.account.role !== 'owner') throw new HTTPException(403, { message: 'Only the workspace owner can do that.' })
  await next()
})
