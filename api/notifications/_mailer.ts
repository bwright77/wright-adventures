import nodemailer from 'nodemailer'

// SMTP transporter — configured via Vercel env vars.
// Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in Vercel dashboard.
// Compatible with any SMTP provider (Gmail, Resend, Postmark, Supabase custom SMTP, etc.)
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: parseInt(process.env.SMTP_PORT ?? '587', 10) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

/**
 * `text` is always required and is what plain-text clients receive. Pass `html`
 * for a richer version; nodemailer sends both as a multipart/alternative so the
 * client picks. Never send html without text — some clients, and most
 * accessibility tooling, read the plain part.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  options?: { replyTo?: string; html?: string },
): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP credentials not configured (SMTP_HOST, SMTP_USER, SMTP_PASS required)')
  }

  const transporter = createTransporter()
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER
  await transporter.sendMail({
    from,
    replyTo: options?.replyTo ?? process.env.SMTP_USER,  // replies go to the account inbox, not a no-reply
    to,
    subject,
    text,
    ...(options?.html ? { html: options.html } : {}),
  })
}
