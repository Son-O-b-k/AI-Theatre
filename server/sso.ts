// Single sign-on (Teams) with OpenID Connect: Google Workspace, Microsoft Entra, Okta and most
// identity providers. One connection per workspace, for one email domain.
//
// Sign-in uses the authorization code flow with PKCE, a one-time state and a nonce; the ID token is
// verified against the provider's published keys, issuer and audience. People from the domain get an
// account and a seat on first sign-in. "Enforced" makes the domain sign in only this way.

import { createHash, randomBytes } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import type { SsoConnection } from '../shared/protocol'
import { markVerified, normalizeEmail, signUp, userByEmail, type Account } from './accounts'
import { now, type Db } from './db'
import { decrypt, encrypt } from './secrets'
import { seatsFor, team } from './teams'

const LOGIN_MINUTES = 10

export const SsoConnectionSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter the email domain, e.g. school.org'),
  issuer: z.string().url().transform((url) => url.replace(/\/$/, '')),
  clientId: z.string().trim().min(1),
  /** Left empty when editing, to keep the stored secret. */
  clientSecret: z.string().optional(),
  enforced: z.boolean().default(false),
})

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

const discoveries = new Map<string, Promise<Discovery>>()

async function discover(issuer: string): Promise<Discovery> {
  let found = discoveries.get(issuer)
  if (!found) {
    found = fetch(`${issuer}/.well-known/openid-configuration`).then(async (response) => {
      if (!response.ok) throw new HTTPException(400, { message: `Could not read the identity provider's settings from ${issuer}.` })
      return (await response.json()) as Discovery
    })
    found.catch(() => discoveries.delete(issuer))
    discoveries.set(issuer, found)
  }
  return found
}

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

interface Row {
  workspace_id: string
  domain: string
  issuer: string
  client_id: string
  client_secret: string
  enforced: number
}

const toInfo = (row: Row): SsoConnection => ({ domain: row.domain, issuer: row.issuer, clientId: row.client_id, enforced: row.enforced === 1 })

const domainOf = (email: string) => normalizeEmail(email).split('@')[1] ?? ''

export async function connectionFor(db: Db, workspaceId: string): Promise<SsoConnection | null> {
  const row = await db.get<Row>('SELECT * FROM sso_connections WHERE workspace_id = ?', workspaceId)
  return row ? toInfo(row) : null
}

async function connectionForDomain(db: Db, email: string): Promise<Row | undefined> {
  return db.get<Row>('SELECT * FROM sso_connections WHERE domain = ?', domainOf(email))
}

/** What the sign-in page needs to know about an address. */
export async function ssoFor(db: Db, email: string): Promise<{ sso: boolean; enforced: boolean }> {
  const row = await connectionForDomain(db, email)
  return { sso: Boolean(row), enforced: row?.enforced === 1 }
}

export async function saveConnection(db: Db, account: Account, input: z.infer<typeof SsoConnectionSchema>): Promise<SsoConnection> {
  const existing = await db.get<Row>('SELECT * FROM sso_connections WHERE workspace_id = ?', account.workspaceId)
  const taken = await db.get<Row>('SELECT * FROM sso_connections WHERE domain = ? AND workspace_id <> ?', input.domain, account.workspaceId)
  if (taken) throw new HTTPException(409, { message: `${input.domain} already signs in to another workspace.` })
  if (!input.clientSecret && !existing) throw new HTTPException(400, { message: 'Enter the client secret.' })
  // The owner's own address must be on the domain, so nobody can claim someone else's.
  if (domainOf(account.email) !== input.domain) throw new HTTPException(400, { message: `Your own email must be on ${input.domain}.` })
  await discover(input.issuer) // check the issuer before saving
  const secret = input.clientSecret ? encrypt(input.clientSecret) : existing!.client_secret
  await db.run(
    `INSERT INTO sso_connections (workspace_id, domain, issuer, client_id, client_secret, enforced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id) DO UPDATE SET domain = excluded.domain, issuer = excluded.issuer, client_id = excluded.client_id,
       client_secret = excluded.client_secret, enforced = excluded.enforced`,
    account.workspaceId, input.domain, input.issuer, input.clientId, secret, input.enforced ? 1 : 0, now(),
  )
  return (await connectionFor(db, account.workspaceId))!
}

export async function removeConnection(db: Db, workspaceId: string): Promise<void> {
  await db.run('DELETE FROM sso_connections WHERE workspace_id = ?', workspaceId)
}

const base64url = (data: Buffer) => data.toString('base64url')

/** The identity provider's sign-in page for this address. */
export async function startLogin(db: Db, email: string, redirectUri: string): Promise<string> {
  const row = await connectionForDomain(db, email)
  if (!row) throw new HTTPException(404, { message: 'Single sign-on is not set up for this email domain.' })
  const discovery = await discover(row.issuer)
  const state = base64url(randomBytes(24))
  const nonce = base64url(randomBytes(24))
  const verifier = base64url(randomBytes(48))
  await db.run(
    'INSERT INTO sso_logins (state, workspace_id, code_verifier, nonce, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    state, row.workspace_id, verifier, nonce, redirectUri, new Date(Date.now() + LOGIN_MINUTES * 60_000).toISOString(),
  )
  const url = new URL(discovery.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: row.client_id,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    login_hint: email,
  }).toString()
  return url.toString()
}

/** Finishes the sign-in: returns the user and the workspace to work in, creating the account if needed. */
export async function completeLogin(db: Db, state: string, code: string): Promise<{ userId: string; workspaceId: string }> {
  const login = await db.get<{ workspace_id: string; code_verifier: string; nonce: string; redirect_uri: string; expires_at: string }>(
    'SELECT * FROM sso_logins WHERE state = ?',
    state,
  )
  await db.run('DELETE FROM sso_logins WHERE state = ?', state) // single use
  if (!login || login.expires_at < now()) throw new HTTPException(400, { message: 'This sign-in link has expired. Please try again.' })
  const row = (await db.get<Row>('SELECT * FROM sso_connections WHERE workspace_id = ?', login.workspace_id))!
  const discovery = await discover(row.issuer)

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: login.redirect_uri,
      client_id: row.client_id,
      client_secret: decrypt(row.client_secret),
      code_verifier: login.code_verifier,
    }),
  })
  if (!response.ok) throw new HTTPException(400, { message: 'The identity provider refused the sign-in.' })
  const { id_token: idToken } = (await response.json()) as { id_token?: string }
  if (!idToken) throw new HTTPException(400, { message: 'The identity provider sent no identity.' })

  let keys = jwks.get(discovery.jwks_uri)
  if (!keys) jwks.set(discovery.jwks_uri, (keys = createRemoteJWKSet(new URL(discovery.jwks_uri))))
  const { payload } = await jwtVerify(idToken, keys, { issuer: discovery.issuer, audience: row.client_id })
  if (payload.nonce !== login.nonce) throw new HTTPException(400, { message: 'The sign-in could not be verified.' })
  const email = normalizeEmail(String(payload.email ?? payload.preferred_username ?? payload.upn ?? ''))
  if (domainOf(email) !== row.domain || payload.email_verified === false) {
    throw new HTTPException(403, { message: `Sign in with your ${row.domain} account.` })
  }

  // First sign-in: an account (with an unusable password) and a seat in the workspace.
  let userId = (await userByEmail(db, email))?.id
  if (!userId) userId = (await signUp(db, email, base64url(randomBytes(32)))).userId
  await markVerified(db, userId)
  const member = await db.get('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?', row.workspace_id, userId)
  if (!member) {
    const current = await team(db, row.workspace_id)
    if (current.members.length + current.invitations.length >= (await seatsFor(db, row.workspace_id))) {
      throw new HTTPException(403, { message: 'All seats in your organisation are in use. Ask its owner for a seat.' })
    }
    await db.run("INSERT INTO members (workspace_id, user_id, role) VALUES (?, ?, 'member')", row.workspace_id, userId)
  }
  return { userId, workspaceId: row.workspace_id }
}

