// Users, their workspaces and sign-in sessions. Every user gets a personal workspace and may be
// invited into others (see teams.ts); lessons, subscriptions and usage belong to a workspace.
// One-time links (email verification, password reset) are random tokens stored only as hashes.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Role, WorkspaceInfo } from '../shared/protocol'
import { newId, now, type Db } from './db'

export type { Role, WorkspaceInfo }

const hash = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>
const SESSION_DAYS = 30
const HOUR = 3_600_000


export interface Account {
  userId: string
  email: string
  emailVerified: boolean
  /** The workspace the session is working in, and the user's role there. */
  workspaceId: string
  role: Role
}

export class AccountError extends Error {}

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

const secretHash = (token: string) => createHash('sha256').update(token).digest('hex')
const randomToken = () => randomBytes(32).toString('base64url')

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${(await hash(password, salt, 64)).toString('hex')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, expected] = stored.split(':')
  const actual = await hash(password, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'))
}

interface UserRow {
  id: string
  email: string
  password_hash: string
  email_verified_at: string | null
}

/** Creates a user and their personal workspace. */
export async function signUp(db: Db, email: string, password: string): Promise<Account> {
  const address = normalizeEmail(email)
  if (await db.get('SELECT 1 FROM users WHERE email = ?', address)) throw new AccountError('An account with this email already exists.')
  const passwordHash = await hashPassword(password)
  const userId = newId()
  const workspaceId = newId()
  const at = now()
  await db.transaction(async (tx) => {
    await tx.run('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)', userId, address, passwordHash, at)
    await tx.run('INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)', workspaceId, address, at)
    await tx.run("INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, 'owner')", workspaceId, userId)
  })
  return { userId, email: address, emailVerified: false, workspaceId, role: 'owner' }
}

export async function signIn(db: Db, email: string, password: string): Promise<Account> {
  await refuseIfSsoOnly(db, email)
  const user = await db.get<UserRow>('SELECT * FROM users WHERE email = ?', normalizeEmail(email))
  if (!user || !(await verifyPassword(password, user.password_hash))) throw new AccountError('Wrong email or password.')
  return account(db, user)
}

/** A domain whose organisation enforces single sign-on cannot use passwords (server/sso.ts). */
export async function refuseIfSsoOnly(db: Db, email: string): Promise<void> {
  const domain = normalizeEmail(email).split('@')[1]
  if (await db.get('SELECT 1 FROM sso_connections WHERE domain = ? AND enforced = 1', domain ?? '')) {
    throw new AccountError('Your organisation signs in with single sign-on. Use "Continue with single sign-on".')
  }
}

/** The account in its preferred workspace, or its first one if it is no longer a member there. */
async function account(db: Db, user: UserRow, preferredWorkspace?: string | null): Promise<Account> {
  const workspaces = await workspacesOf(db, user.id)
  const workspace = workspaces.find((w) => w.id === preferredWorkspace) ?? workspaces[0]
  return { userId: user.id, email: user.email, emailVerified: user.email_verified_at !== null, workspaceId: workspace.id, role: workspace.role }
}

export async function workspacesOf(db: Db, userId: string): Promise<WorkspaceInfo[]> {
  return db.all<WorkspaceInfo>(
    'SELECT w.id, w.name, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.created_at',
    userId,
  )
}

export async function userByEmail(db: Db, email: string): Promise<{ id: string; email: string } | undefined> {
  return db.get('SELECT id, email FROM users WHERE email = ?', normalizeEmail(email))
}

// ── Sessions: the browser holds a random token; the database holds only its hash. ──────────

export async function createSession(db: Db, userId: string, workspaceId?: string): Promise<{ token: string; expires: Date }> {
  const token = randomToken()
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db.run('INSERT INTO sessions (id, user_id, expires_at, workspace_id) VALUES (?, ?, ?, ?)', secretHash(token), userId, expires.toISOString(), workspaceId ?? null)
  return { token, expires }
}

export async function accountForSession(db: Db, token: string): Promise<Account | null> {
  const row = await db.get<UserRow & { session_workspace: string | null }>(
    'SELECT u.*, s.workspace_id AS session_workspace FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?',
    secretHash(token),
    now(),
  )
  return row ? account(db, row, row.session_workspace) : null
}

/** Makes `workspaceId` the session's working workspace; the user must be a member. */
export async function switchWorkspace(db: Db, token: string, userId: string, workspaceId: string): Promise<void> {
  if (!(await db.get('SELECT 1 FROM members WHERE user_id = ? AND workspace_id = ?', userId, workspaceId))) {
    throw new AccountError('You are not a member of that workspace.')
  }
  await db.run('UPDATE sessions SET workspace_id = ? WHERE id = ?', workspaceId, secretHash(token))
}

export async function endSession(db: Db, token: string): Promise<void> {
  await db.run('DELETE FROM sessions WHERE id = ?', secretHash(token))
}

/** Whether any account exists yet (the first one inherits lessons made before accounts). */
export const hasUsers = async (db: Db) => Boolean(await db.get('SELECT 1 FROM users LIMIT 1'))

// ── One-time links ──────────────────────────────────────────────────────────

type LinkKind = 'verify_email' | 'reset_password'
const LINK_LIFETIME: Record<LinkKind, number> = { verify_email: 48 * HOUR, reset_password: HOUR }

async function createLink(db: Db, kind: LinkKind, userId: string): Promise<string> {
  const token = randomToken()
  await db.run(
    'INSERT INTO tokens (id, kind, user_id, expires_at) VALUES (?, ?, ?, ?)',
    secretHash(token), kind, userId, new Date(Date.now() + LINK_LIFETIME[kind]).toISOString(),
  )
  return token
}

/** Uses up a link; resolves to its user, or throws if it is unknown, used or expired. */
async function consumeLink(db: Db, kind: LinkKind, token: string): Promise<string> {
  const id = secretHash(token)
  const used = await db.run('UPDATE tokens SET used_at = ? WHERE id = ? AND kind = ? AND used_at IS NULL AND expires_at > ?', now(), id, kind, now())
  if (used !== 1) throw new AccountError('This link has expired or was already used. Please ask for a new one.')
  const row = await db.get<{ user_id: string }>('SELECT user_id FROM tokens WHERE id = ?', id)
  return row!.user_id
}

export const createVerificationLink = (db: Db, userId: string) => createLink(db, 'verify_email', userId)

export async function verifyEmail(db: Db, token: string): Promise<void> {
  await markVerified(db, await consumeLink(db, 'verify_email', token))
}

export async function markVerified(db: Db, userId: string): Promise<void> {
  await db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), userId)
}

/** A reset link for the account with this email, or null if there is none (callers must not reveal which). */
export async function createPasswordResetLink(db: Db, email: string): Promise<string | null> {
  const user = await userByEmail(db, email)
  return user ? createLink(db, 'reset_password', user.id) : null
}

/** Sets a new password and signs out every session; the reset also proves the email address. */
export async function resetPassword(db: Db, token: string, password: string): Promise<Account> {
  const userId = await consumeLink(db, 'reset_password', token)
  const passwordHash = await hashPassword(password)
  await db.transaction(async (tx) => {
    await tx.run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, userId)
    await tx.run('DELETE FROM sessions WHERE user_id = ?', userId)
  })
  await markVerified(db, userId)
  return account(db, (await db.get<UserRow>('SELECT * FROM users WHERE id = ?', userId))!)
}
