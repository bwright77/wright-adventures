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

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  options?: { replyTo?: string },
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
  })
}
