// Every email the product sends, in one place. Each template takes its data and returns the
// subject, HTML and plain-text versions; the shared frame is in ./layout.ts.
// Billing emails (receipts, failed payments) are sent by the payment provider, not from here.

import { layout } from './layout'

export type { Email } from './layout'

export const templates = {
  verifyEmail: ({ url }: { url: string }) =>
    layout({
      subject: 'Confirm your email for AI Theatre',
      preview: 'One click to confirm your address.',
      heading: 'Confirm your email',
      paragraphs: ['Thanks for signing up. Please confirm this is your email address, so we can reach you about your account and payments.'],
      action: { label: 'Confirm my email', url },
      note: 'This link works for 48 hours.',
    }),

  resetPassword: ({ url }: { url: string }) =>
    layout({
      subject: 'Reset your AI Theatre password',
      preview: 'A link to choose a new password.',
      heading: 'Choose a new password',
      paragraphs: ['Someone asked to reset the password for this account. If that was you, use the button below.'],
      action: { label: 'Reset my password', url },
      note: 'This link works for 1 hour and only once. Your password stays the same until you choose a new one.',
    }),

  teamInvite: ({ url, inviter, workspace }: { url: string; inviter: string; workspace: string }) =>
    layout({
      subject: `${inviter} invited you to ${workspace} on AI Theatre`,
      preview: 'Join the team and share lessons.',
      heading: `Join ${workspace}`,
      paragraphs: [`${inviter} invited you to join ${workspace} on AI Theatre, where the team makes and shares animated lessons.`],
      action: { label: 'Accept the invitation', url },
      note: 'This invitation works for 7 days.',
    }),
}

export type TemplateName = keyof typeof templates
