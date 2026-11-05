import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { switchWorkspace } from '../accounts'
import { templates } from '../email'
import { acceptInvitation, invitationDetails, invite, removeMember, renameWorkspace, revokeInvitation, team } from '../teams'
import { requireFeature } from '../features'
import { connectionFor, removeConnection, saveConnection, SsoConnectionSchema } from '../sso'
import { requireAccount, requireOwner, SESSION_COOKIE, siteUrl, type AppEnv, type Deps } from './context'

/** The signed-in workspace's people: members, seats and invitations. */
export function teamRoutes({ db, billing, mailer }: Deps) {
  const app = new Hono<AppEnv>()
  const signedIn = requireAccount(db)

  app.get('/', signedIn, async (c) => c.json(await team(db, c.var.account.workspaceId)))

  app.patch('/', signedIn, async (c) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(await c.req.json())
    await renameWorkspace(db, c.var.account, name)
    return c.json(await team(db, c.var.account.workspaceId))
  })

  app.post('/invitations', signedIn, async (c) => {
    const { email } = z.object({ email: z.string().email('Enter a valid email address.') }).parse(await c.req.json())
    const account = c.var.account
    const { token, invitation } = await invite(db, account, email)
    const { workspace } = await team(db, account.workspaceId)
    await mailer.send(
      invitation.email,
      templates.teamInvite({ url: `${siteUrl(c)}/app/invite?token=${token}`, inviter: account.email, workspace: workspace.name }),
    )
    return c.json(await team(db, account.workspaceId))
  })

  app.delete('/invitations/:id', signedIn, async (c) => {
    await revokeInvitation(db, c.var.account, c.req.param('id'))
    return c.json(await team(db, c.var.account.workspaceId))
  })

  app.delete('/members/:userId', signedIn, async (c) => {
    await removeMember(db, c.var.account, c.req.param('userId'))
    return c.json(await team(db, c.var.account.workspaceId))
  })

  // The invitation page: who invited whom, shown before signing in.
  app.get('/invitations/:token', async (c) => c.json(await invitationDetails(db, c.req.param('token'))))

  app.post('/invitations/accept', signedIn, async (c) => {
    const { token } = z.object({ token: z.string() }).parse(await c.req.json())
    const workspaceId = await acceptInvitation(db, c.var.account, token)
    await switchWorkspace(db, getCookie(c, SESSION_COOKIE)!, c.var.account.userId, workspaceId)
    return c.body(null, 204)
  })

  // Single sign-on settings (Teams).
  app.get('/sso', signedIn, async (c) => c.json(await connectionFor(db, c.var.account.workspaceId)))

  app.put('/sso', signedIn, requireOwner, requireFeature(billing, 'sso', 'Single sign-on'), async (c) =>
    c.json(await saveConnection(db, c.var.account, SsoConnectionSchema.parse(await c.req.json()))),
  )

  app.delete('/sso', signedIn, requireOwner, async (c) => {
    await removeConnection(db, c.var.account.workspaceId)
    return c.body(null, 204)
  })

  return app
}
