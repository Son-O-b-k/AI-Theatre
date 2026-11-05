import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import {
  createPasswordResetLink,
  createSession,
  createVerificationLink,
  endSession,
  hasUsers,
  refuseIfSsoOnly,
  resetPassword,
  signIn,
  signUp,
  switchWorkspace,
  verifyEmail,
  workspacesOf,
  type Account,
} from '../accounts'
import { effectiveBrand } from '../brand'
import { templates } from '../email'
import { completeLogin, ssoFor, startLogin } from '../sso'
import { adoptLegacyProjects } from '../store'
import { requireAccount, SESSION_COOKIE, siteUrl, type AppEnv, type Deps } from './context'

const Email = z.string().email('Enter a valid email address.')
const Password = z.string().min(8, 'Use at least 8 characters for the password.').max(200)
const Credentials = z.object({ email: Email, password: Password })
const Token = z.object({ token: z.string().min(10).max(200) })

export function authRoutes({ db, billing, mailer }: Deps) {
  const app = new Hono<AppEnv>()
  const signedIn = requireAccount(db)

  const startSession = async (c: Context<AppEnv>, account: Account, workspaceId?: string) => {
    const { token, expires } = await createSession(db, account.userId, workspaceId)
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires,
    })
    return c.json({ email: account.email })
  }

  const sendVerification = async (c: Context, account: Account) => {
    const token = await createVerificationLink(db, account.userId)
    await mailer.send(account.email, templates.verifyEmail({ url: `${siteUrl(c)}/app/verify?token=${token}` }))
  }

  app.post('/signup', async (c) => {
    const { email, password } = Credentials.parse(await c.req.json())
    await refuseIfSsoOnly(db, email)
    const first = !(await hasUsers(db))
    const account = await signUp(db, email, password)
    if (first) await adoptLegacyProjects(account.workspaceId)
    await sendVerification(c, account)
    return startSession(c, account)
  })

  app.post('/login', async (c) => {
    const { email, password } = Credentials.parse(await c.req.json())
    return startSession(c, await signIn(db, email, password))
  })

  app.post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) await endSession(db, token)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  app.get('/me', signedIn, async (c) => {
    const { email, emailVerified, workspaceId, role, userId } = c.var.account
    return c.json({
      email,
      emailVerified,
      workspace: { id: workspaceId, role },
      workspaces: await workspacesOf(db, userId),
      billing: await billing.summary(workspaceId),
      brand: await effectiveBrand(db, billing, workspaceId),
    })
  })

  app.post('/workspace', signedIn, async (c) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(await c.req.json())
    await switchWorkspace(db, getCookie(c, SESSION_COOKIE)!, c.var.account.userId, workspaceId)
    return c.body(null, 204)
  })

  // Email verification: the link works whether or not the person is signed in.
  app.post('/verify', async (c) => {
    await verifyEmail(db, Token.parse(await c.req.json()).token)
    return c.body(null, 204)
  })

  app.post('/verify/resend', signedIn, async (c) => {
    if (!c.var.account.emailVerified) await sendVerification(c, c.var.account)
    return c.body(null, 204)
  })

  // Password reset. The answer never says whether an account exists for the address.
  app.post('/password/forgot', async (c) => {
    const { email } = z.object({ email: Email }).parse(await c.req.json())
    const token = await createPasswordResetLink(db, email)
    if (token) await mailer.send(email, templates.resetPassword({ url: `${siteUrl(c)}/app/reset?token=${token}` }))
    return c.body(null, 204)
  })

  app.post('/password/reset', async (c) => {
    const { token, password } = Token.extend({ password: Password }).parse(await c.req.json())
    return startSession(c, await resetPassword(db, token, password))
  })

  // Single sign-on: the sign-in page asks whether an address uses it, then sends people here.
  app.get('/sso', async (c) => c.json(await ssoFor(db, z.string().email().parse(c.req.query('email')))))

  app.get('/sso/start', async (c) => {
    const email = z.string().email().parse(c.req.query('email'))
    return c.redirect(await startLogin(db, email, `${siteUrl(c)}/api/auth/sso/callback`))
  })

  app.get('/sso/callback', async (c) => {
    const { state, code, error_description: refused } = c.req.query()
    try {
      if (refused || !state || !code) throw new Error(refused ?? 'The sign-in was cancelled.')
      const { userId, workspaceId } = await completeLogin(db, state, code)
      const { token, expires } = await createSession(db, userId, workspaceId)
      setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production', path: '/', expires })
      return c.redirect('/app')
    } catch (error) {
      return c.redirect(`/app?sso_error=${encodeURIComponent(error instanceof Error ? error.message : String(error))}`)
    }
  })

  return app
}
