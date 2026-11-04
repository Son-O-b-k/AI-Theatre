// Sends email. With SMTP settings in .env it uses that server; without them, each email is
// written to data/outbox/ and its links are printed in the server log, so sign-up, password
// reset and invitations work before any email service is set up.
//
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE (true for port 465),
//   SMTP_USER, SMTP_PASS, EMAIL_FROM (e.g. "AI Theatre <hello@yourdomain.com>")

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import type { Email } from './templates'

export { templates } from './templates'

export interface Mailer {
  /** Where mail goes: 'smtp' or 'outbox'. */
  readonly mode: 'smtp' | 'outbox'
  send(to: string, email: Email): Promise<void>
}

export function createMailer(env = process.env): Mailer {
  if (env.SMTP_HOST) return smtpMailer(env)
  if (env.NODE_ENV === 'production') console.warn('Email: SMTP_HOST is not set; emails are written to the outbox and not delivered')
  return outboxMailer(join(resolve(env.DATA_DIR ?? 'data'), 'outbox'))
}

function smtpMailer(env: NodeJS.ProcessEnv): Mailer {
  const port = Number(env.SMTP_PORT ?? 587)
  const transport: Transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  const from = env.EMAIL_FROM ?? env.SMTP_USER
  if (!from) throw new Error('Set EMAIL_FROM (or SMTP_USER) to send email')
  console.log(`Email: sending through ${env.SMTP_HOST}:${port}`)
  return {
    mode: 'smtp',
    async send(to, email) {
      await transport.sendMail({ from, to, subject: email.subject, html: email.html, text: email.text })
    },
  }
}

function outboxMailer(dir: string): Mailer {
  console.log(`Email: no SMTP settings, writing emails to ${dir}`)
  return {
    mode: 'outbox',
    async send(to, email) {
      await mkdir(dir, { recursive: true })
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${to.replace(/[^\w.@-]/g, '_')}`
      await writeFile(join(dir, `${name}.html`), email.html)
      await writeFile(join(dir, `${name}.txt`), `To: ${to}\nSubject: ${email.subject}\n\n${email.text}`)
      const link = email.text.match(/https?:\/\/\S+/)?.[0]
      console.log(`Email (outbox) to ${to}: ${email.subject}${link ? `\n  ${link}` : ''}`)
    },
  }
}
