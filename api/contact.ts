import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendEmail } from './notifications/_mailer.js'

interface ContactPayload {
  name: string
  org: string
  email: string
  orgType?: string
  challenge?: string
  message?: string
}

const ORG_TYPE_LABELS: Record<string, string> = {
  conservation: 'Conservation nonprofit',
  youth: 'Youth program',
  watershed: 'Watershed / environmental',
  community: 'Community organization',
  other: 'Other',
}

const CHALLENGE_LABELS: Record<string, string> = {
  funding: 'Growing our funding',
  programs: 'Building / scaling programs',
  compliance: 'Navigating compliance',
  technology: 'Accessing technology',
  all: 'All of the above',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { name, org, email, orgType, challenge, message } = req.body as ContactPayload

  if (!name?.trim() || !org?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'name, org, and email are required' })
  }

  const to = process.env.CONTACT_EMAIL ?? 'info@wrightadventures.org'
  const subject = `Partnership inquiry from ${name} — ${org}`
  const text = [
    `New partnership inquiry submitted via wrightadventures.org`,
    '',
    `Name:             ${name}`,
    `Organization:     ${org}`,
    `Email:            ${email}`,
    orgType ? `Org type:         ${ORG_TYPE_LABELS[orgType] ?? orgType}` : null,
    challenge ? `Biggest challenge: ${CHALLENGE_LABELS[challenge] ?? challenge}` : null,
    message?.trim() ? `\nMessage:\n${message.trim()}` : null,
  ].filter(Boolean).join('\n')

  try {
    await sendEmail(to, subject, text, { replyTo: email })
    return res.status(200).json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[contact] sendEmail failed:', message)
    return res.status(500).json({ error: 'Failed to send message. Please try again.' })
  }
}
