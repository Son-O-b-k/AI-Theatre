// Picks the payment service from billing.json. Without that file the dev provider is used, so
// everything works locally without an account; production must configure a real one.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { resolveSecret } from '../../config'
import type { BillingProvider } from '../types'
import { DevBillingProvider } from './dev'
import { LemonSqueezyProvider } from './lemonsqueezy'

const secret = z.string().transform((value, ctx) => {
  const resolved = resolveSecret(value)
  if (!resolved) ctx.addIssue({ code: 'custom', message: `${value} is not set` })
  return resolved ?? ''
})

const ConfigSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('dev') }),
  z.object({
    provider: z.literal('lemonsqueezy'),
    apiKey: secret,
    storeId: z.string(),
    webhookSecret: secret,
    variants: z.record(z.string().regex(/^(creator|pro):(month|year)$/), z.string()),
  }),
])

export async function loadBillingProvider(): Promise<BillingProvider> {
  const file = process.env.BILLING_FILE ?? 'billing.json'
  if (!existsSync(file)) {
    if (process.env.NODE_ENV === 'production') throw new Error(`${file} is missing: configure a payment provider`)
    console.log('Billing: no billing.json, using the dev provider (no real payments)')
    return new DevBillingProvider()
  }
  const config = ConfigSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  console.log(`Billing: ${config.provider}`)
  return config.provider === 'dev' ? new DevBillingProvider() : new LemonSqueezyProvider(config)
}
