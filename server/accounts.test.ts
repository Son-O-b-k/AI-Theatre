// Run with `npm test`. Email verification, password reset, teams and the email templates.
// TEST_DATABASE_URL=postgres://... runs the database tests against Postgres.

import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import {
  accountForSession,
  createPasswordResetLink,
  createSession,
  createVerificationLink,
  resetPassword,
  signIn,
  signUp,
  switchWorkspace,
  verifyEmail,
  workspacesOf,
  type Account,
} from './accounts'
import { setManualPlan } from './admin'
import type { Db } from './db'
import { createMailer, templates } from './email'
import { acceptInvitation, invitationDetails, invite, removeMember, revokeInvitation, team } from './teams'
import { freshDb } from './test-db'

const inAYear = () => new Date(Date.now() + 365 * 86_400_000)

describe('accounts', () => {
  let db: Db
  let ada: Account

  beforeEach(async () => {
    db = await freshDb()
    ada = await signUp(db, 'ada@example.com', 'first password')
  })

  afterEach(() => db.close())

  test('a new account is unconfirmed until its link is used, once', async () => {
    assert.equal(ada.emailVerified, false)
    const token = await createVerificationLink(db, ada.userId)
    await verifyEmail(db, token)
    assert.equal((await signIn(db, 'ada@example.com', 'first password')).emailVerified, true)
    await assert.rejects(verifyEmail(db, token), /expired or was already used/)
  })

  test('a password reset changes the password, signs out everywhere and works once', async () => {
    const { token: session } = await createSession(db, ada.userId)
    assert.equal(await createPasswordResetLink(db, 'nobody@example.com'), null)
    const link = (await createPasswordResetLink(db, 'ADA@example.com'))!

    const after = await resetPassword(db, link, 'second password')
    assert.equal(after.emailVerified, true)
    assert.equal(await accountForSession(db, session), null)
    await assert.rejects(signIn(db, 'ada@example.com', 'first password'), /Wrong email or password/)
    await signIn(db, 'ada@example.com', 'second password')
    await assert.rejects(resetPassword(db, link, 'third password'), /expired or was already used/)
  })

  test('an expired reset link is refused', async () => {
    const link = (await createPasswordResetLink(db, 'ada@example.com'))!
    await db.run('UPDATE tokens SET expires_at = ?', new Date(Date.now() - 1000).toISOString())
    await assert.rejects(resetPassword(db, link, 'second password'), /expired/)
  })
})

describe('teams', () => {
  let db: Db
  let owner: Account

  beforeEach(async () => {
    db = await freshDb()
    owner = await signUp(db, 'owner@school.example', 'owner password')
  })

  afterEach(() => db.close())

  test('inviting needs a plan with seats', async () => {
    await assert.rejects(invite(db, owner, 'grace@school.example'), /needs the Teams plan/)
  })

  test('an invited person joins with the invited address and shares the workspace', async () => {
    await setManualPlan(db, owner.workspaceId, 'teams', 3, inAYear())
    const { token } = await invite(db, owner, 'Grace@School.example')
    assert.deepEqual(await invitationDetails(db, token), { workspace: 'owner@school.example', inviter: 'owner@school.example', email: 'grace@school.example' })

    const stranger = await signUp(db, 'mallory@example.com', 'some password')
    await assert.rejects(acceptInvitation(db, stranger, token), /This invitation is for grace@school.example/)

    const grace = await signUp(db, 'grace@school.example', 'grace password')
    const workspaceId = await acceptInvitation(db, grace, token)
    assert.equal(workspaceId, owner.workspaceId)
    // She keeps her own workspace and is a member of the team's.
    assert.deepEqual((await workspacesOf(db, grace.userId)).map((w) => w.role).sort(), ['member', 'owner'])

    // Her session can switch into the team workspace, where she is a member.
    const { token: session } = await createSession(db, grace.userId)
    await switchWorkspace(db, session, grace.userId, owner.workspaceId)
    const inTeam = (await accountForSession(db, session))!
    assert.deepEqual([inTeam.workspaceId, inTeam.role, inTeam.emailVerified], [owner.workspaceId, 'member', true])
    await assert.rejects(invite(db, inTeam, 'other@school.example'), /Only the workspace owner/)
    await assert.rejects(acceptInvitation(db, grace, token), /expired or was withdrawn/)
  })

  test('seats count members and pending invitations; revoking and removing free them', async () => {
    await setManualPlan(db, owner.workspaceId, 'teams', 3, inAYear())
    const first = await invite(db, owner, 'one@school.example')
    await invite(db, owner, 'two@school.example')
    await assert.rejects(invite(db, owner, 'three@school.example'), /All 3 seats are in use/)
    await assert.rejects(invite(db, owner, 'two@school.example'), /already been invited/)

    await revokeInvitation(db, owner, first.invitation.id)
    await assert.rejects(acceptInvitation(db, await signUp(db, 'one@school.example', 'one password'), first.token), /withdrawn/)

    const three = await invite(db, owner, 'three@school.example')
    const member = await signUp(db, 'three@school.example', 'three password')
    await acceptInvitation(db, member, three.token)
    assert.deepEqual((await team(db, owner.workspaceId)).members.map((m) => m.role), ['owner', 'member'])

    await removeMember(db, owner, member.userId)
    assert.equal((await team(db, owner.workspaceId)).members.length, 1)
    await assert.rejects(removeMember(db, owner, owner.userId), /cannot remove themselves/)
  })
})

describe('email', () => {
  test('every template has a subject, a link and escaped HTML', () => {
    const url = 'https://site.example/app/x?token=abc&next=1'
    const rendered = [
      templates.verifyEmail({ url }),
      templates.resetPassword({ url }),
      templates.teamInvite({ url, inviter: 'Ada <ada@example.com>', workspace: 'Physics & Co' }),
    ]
    for (const email of rendered) {
      assert.ok(email.subject.length > 0)
      assert.ok(email.text.includes(url))
      assert.ok(email.html.includes('token=abc&amp;next=1'))
      assert.ok(!email.html.includes('<ada@example.com>'))
    }
    assert.ok(rendered[2].html.includes('Physics &amp; Co'))
  })

  test('without SMTP settings, emails are written to the outbox', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outbox-'))
    const mailer = createMailer({ DATA_DIR: dir })
    assert.equal(mailer.mode, 'outbox')
    await mailer.send('ada@example.com', templates.resetPassword({ url: 'https://site.example/app/reset?token=t' }))
    const files = await readdir(join(dir, 'outbox'))
    assert.deepEqual(files.map((f) => f.split('.').pop()).sort(), ['html', 'txt'])
    const text = await readFile(join(dir, 'outbox', files.find((f) => f.endsWith('.txt'))!), 'utf8')
    assert.match(text, /^To: ada@example.com\nSubject: Reset your AI Theatre password/)
  })

  test('with SMTP settings, mail goes to the server', () => {
    assert.equal(createMailer({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'AI Theatre <hello@example.com>' }).mode, 'smtp')
  })
})
