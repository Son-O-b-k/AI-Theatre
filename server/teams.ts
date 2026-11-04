// Workspace members and invitations. A workspace's plan sets how many seats it has (shared/plans.ts,
// or the subscription's own count for Teams contracts); members and pending invitations use them.
// Owners invite and remove people; members make and edit lessons and share the allowance.

import { createHash, randomBytes } from 'node:crypto'
import { PLANS } from '../shared/plans'
import type { InvitationDetails, Team } from '../shared/protocol'
import { AccountError, markVerified, normalizeEmail, type Account, type Role } from './accounts'
import { effectivePlan } from './billing/entitlements'
import { subscriptionFor } from './billing/repo'
import { newId, now, type Db } from './db'

const INVITE_DAYS = 7
const secretHash = (token: string) => createHash('sha256').update(token).digest('hex')

type Member = Team['members'][number]
type Invitation = Team['invitations'][number]

export async function seatsFor(db: Db, workspaceId: string): Promise<number> {
  const subscription = await subscriptionFor(db, workspaceId)
  const plan = effectivePlan(subscription)
  return plan === 'teams' && subscription?.seats ? subscription.seats : PLANS[plan].seats
}

export async function team(db: Db, workspaceId: string): Promise<Team> {
  const workspace = (await db.get<{ id: string; name: string }>('SELECT id, name FROM workspaces WHERE id = ?', workspaceId))!
  const members = await db.all<Member>(
    'SELECT u.id AS "userId", u.email, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY m.role DESC, u.email',
    workspaceId,
  )
  const invitations = await db.all<Invitation>(
    `SELECT id, email, role, expires_at AS "expiresAt" FROM invitations
     WHERE workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at`,
    workspaceId,
    now(),
  )
  return { workspace, seats: await seatsFor(db, workspaceId), members, invitations }
}

function requireOwner(account: Account): void {
  if (account.role !== 'owner') throw new AccountError('Only the workspace owner can do that.')
}

export async function renameWorkspace(db: Db, account: Account, name: string): Promise<void> {
  requireOwner(account)
  await db.run('UPDATE workspaces SET name = ? WHERE id = ?', name.trim().slice(0, 80), account.workspaceId)
}

/** Creates an invitation and returns its token, for the email. Pending invitations hold a seat. */
export async function invite(db: Db, account: Account, email: string): Promise<{ token: string; invitation: Invitation }> {
  requireOwner(account)
  const address = normalizeEmail(email)
  const current = await team(db, account.workspaceId)
  if (current.members.some((m) => m.email === address)) throw new AccountError(`${address} is already in this workspace.`)
  if (current.invitations.some((i) => i.email === address)) throw new AccountError(`${address} has already been invited.`)
  if (current.members.length + current.invitations.length >= current.seats) {
    throw new AccountError(
      current.seats === 1
        ? 'Inviting people needs the Teams plan. Contact us to set it up.'
        : `All ${current.seats} seats are in use. Remove someone or ask us for more seats.`,
    )
  }
  const token = randomBytes(32).toString('base64url')
  const invitation: Invitation = { id: newId(), email: address, role: 'member', expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() }
  await db.run(
    'INSERT INTO invitations (id, token_hash, workspace_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    invitation.id, secretHash(token), account.workspaceId, address, invitation.role, account.userId, now(), invitation.expiresAt,
  )
  return { token, invitation }
}

export async function revokeInvitation(db: Db, account: Account, id: string): Promise<void> {
  requireOwner(account)
  await db.run('UPDATE invitations SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL', now(), id, account.workspaceId)
}

export async function removeMember(db: Db, account: Account, userId: string): Promise<void> {
  requireOwner(account)
  if (userId === account.userId) throw new AccountError('Owners cannot remove themselves.')
  await db.transaction(async (tx) => {
    await tx.run("DELETE FROM members WHERE workspace_id = ? AND user_id = ? AND role <> 'owner'", account.workspaceId, userId)
    // Their sessions fall back to their own workspace.
    await tx.run('UPDATE sessions SET workspace_id = NULL WHERE user_id = ? AND workspace_id = ?', userId, account.workspaceId)
  })
}

interface PendingRow {
  id: string
  workspace_id: string
  email: string
  role: Role
  workspace: string
  inviter: string
}

async function pending(db: Db, token: string): Promise<PendingRow> {
  const row = await db.get<PendingRow>(
    `SELECT i.id, i.workspace_id, i.email, i.role, w.name AS workspace, u.email AS inviter
     FROM invitations i JOIN workspaces w ON w.id = i.workspace_id JOIN users u ON u.id = i.invited_by
     WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
    secretHash(token),
    now(),
  )
  if (!row) throw new AccountError('This invitation has expired or was withdrawn. Ask for a new one.')
  return row
}

/** What the invitation page shows before the person signs in. */
export async function invitationDetails(db: Db, token: string): Promise<InvitationDetails> {
  const { workspace, inviter, email } = await pending(db, token)
  return { workspace, inviter, email }
}

/**
 * Joins the workspace. The invitation goes to one address, so only the account with that email
 * can accept it; following the emailed link also confirms that address. Returns the workspace id.
 */
export async function acceptInvitation(db: Db, account: Account, token: string): Promise<string> {
  const invitation = await pending(db, token)
  if (invitation.email !== account.email) {
    throw new AccountError(`This invitation is for ${invitation.email}. Sign in with that address to accept it.`)
  }
  await db.transaction(async (tx) => {
    await tx.run('UPDATE invitations SET accepted_at = ? WHERE id = ?', now(), invitation.id)
    await tx.run(
      'INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (workspace_id, user_id) DO NOTHING',
      invitation.workspace_id, account.userId, invitation.role,
    )
  })
  await markVerified(db, account.userId)
  return invitation.workspace_id
}
