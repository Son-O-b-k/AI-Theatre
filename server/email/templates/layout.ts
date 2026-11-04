// The frame every email shares: brand header, one message, one button, a quiet footer.
// Email clients ignore stylesheets and most modern CSS, so this is tables and inline styles.

export interface Email {
  subject: string
  html: string
  text: string
}

const INK = '#1d1b17'
const DIM = '#5c564c'
const PAPER = '#f4f0e6'
const CARD = '#fffdf8'
const ACCENT = '#c8402a'
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

export const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

interface Content {
  subject: string
  /** Shown in the inbox list after the subject. */
  preview: string
  heading: string
  /** Paragraphs of plain text (escaped here). */
  paragraphs: string[]
  action: { label: string; url: string }
  /** Small print under the button, e.g. when the link expires. */
  note?: string
}

export function layout({ subject, preview, heading, paragraphs, action, note }: Content): Email {
  const p = (text: string) => `<p style="margin:0 0 16px;font:16px/1.6 ${SANS};color:${DIM}">${escape(text)}</p>`
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAPER}">
<div style="display:none;max-height:0;overflow:hidden">${escape(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}">
  <tr><td align="center" style="padding:40px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td style="padding:0 4px 20px;font:bold 20px ${SERIF};color:${INK}">AI Theatre<span style="color:${ACCENT}">.</span></td></tr>
      <tr><td style="background:${CARD};border:1px solid #e4ddcf;border-radius:12px;padding:32px">
        <h1 style="margin:0 0 16px;font:normal 26px/1.25 ${SERIF};color:${INK}">${escape(heading)}</h1>
        ${paragraphs.map(p).join('\n        ')}
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr>
          <td style="background:${INK};border-radius:8px">
            <a href="${escape(action.url)}" style="display:inline-block;padding:12px 22px;font:600 15px ${SANS};color:${CARD};text-decoration:none">${escape(action.label)}</a>
          </td>
        </tr></table>
        ${note ? `<p style="margin:16px 0 0;font:13px/1.5 ${SANS};color:${DIM}">${escape(note)}</p>` : ''}
        <p style="margin:16px 0 0;font:12px/1.5 ${SANS};color:#8a8376">If the button does not work, paste this link into your browser:<br><a href="${escape(action.url)}" style="color:#8a8376;word-break:break-all">${escape(action.url)}</a></p>
      </td></tr>
      <tr><td style="padding:20px 4px;font:12px/1.5 ${SANS};color:#8a8376">You received this because of an action on AI Theatre. If it was not you, you can ignore this email.</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
  const text = [heading, '', ...paragraphs.flatMap((t) => [t, '']), `${action.label}: ${action.url}`, ...(note ? ['', note] : [])].join('\n')
  return { subject, html, text }
}
