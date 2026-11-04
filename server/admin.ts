// Operations done by us rather than through the app: Teams plans are sold by quote and invoice,
// so they are switched on here instead of through the payment service.
//
//   npm run admin -- set-plan <owner email> teams --seats 10 --months 12 --name "Lagos Science School"
//   npm run admin -- end-plan <owner email>

import { existsSync } from 'node:fs'
import { PLANS, type PlanId } from '../shared/plans'
import { userByEmail, workspacesOf } from './accounts'
import { saveSubscription, subscriptionFor } from './billing/repo'
import { openDb, type Db } from './db'

export const MANUAL_PROVIDER = 'manual'

/** Puts the workspace on `plan` until `until`, billed outside the app. */
export async function setManualPlan(db: Db, workspaceId: string, plan: PlanId, seats: number | null, until: Date): Promise<void> {
  const existing = await subscriptionFor(db, workspaceId)
  await saveSubscription(db, {
    workspaceId,
    provider: MANUAL_PROVIDER,
    providerSubscriptionId: `manual-${workspaceId}`,
    customerId: existing?.customerId ?? null,
    plan,
    interval: 'year',
    status: 'active',
    currentPeriodEnd: until.toISOString(),
    cancelAtPeriodEnd: false,
    previousPlan: null,
    previousPlanUntil: null,
    discountCode: null,
    portalUrl: null,
    seats,
  })
}

export async function endManualPlan(db: Db, workspaceId: string): Promise<void> {
  const existing = await subscriptionFor(db, workspaceId)
  if (existing?.provider !== MANUAL_PROVIDER) throw new Error('That workspace is not on an invoiced plan.')
  await saveSubscription(db, { ...existing, status: 'expired' })
}

/** The workspace the person owns (their first one). */
async function ownedWorkspace(db: Db, email: string): Promise<string> {
  const user = await userByEmail(db, email)
  if (!user) throw new Error(`No account for ${email}`)
  const owned = (await workspacesOf(db, user.id)).find((w) => w.role === 'owner')
  if (!owned) throw new Error(`${email} owns no workspace`)
  return owned.id
}

async function main(args: string[]): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env')
  const [command, email, plan] = args
  const text = (name: string) => {
    const index = args.indexOf(`--${name}`)
    return index === -1 ? undefined : args[index + 1]
  }
  const option = (name: string) => (text(name) === undefined ? undefined : Number(text(name)))
  const db = await openDb()
  try {
    if (command === 'set-plan' && email && plan && plan in PLANS) {
      const months = option('months') ?? 12
      const until = new Date()
      until.setMonth(until.getMonth() + months)
      const workspaceId = await ownedWorkspace(db, email)
      await setManualPlan(db, workspaceId, plan as PlanId, option('seats') ?? null, until)
      const name = text('name')
      if (name) await db.run('UPDATE workspaces SET name = ? WHERE id = ?', name, workspaceId)
      console.log(`${email}: ${plan}${option('seats') ? `, ${option('seats')} seats` : ''}, until ${until.toDateString()}`)
    } else if (command === 'end-plan' && email) {
      await endManualPlan(db, await ownedWorkspace(db, email))
      console.log(`${email}: invoiced plan ended`)
    } else {
      console.log('Usage:\n  npm run admin -- set-plan <owner email> <plan> [--seats N] [--months N] [--name "Workspace name"]\n  npm run admin -- end-plan <owner email>')
      process.exitCode = 1
    }
  } finally {
    await db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
