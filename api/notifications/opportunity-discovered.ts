import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_mailer'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Supabase Database Webhook payload shape for the opportunities table
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: {
    id: string
    name: string
    funder: string | null
    status: string
    auto_discovered: boolean
    ai_match_score: number | null
    ai_match_rationale: string | null
    amount_max: number | null
    primary_deadline: string | null
  }
  old_record: null
}

// ── Handler ───────────────────────────────────────────────────
// POST — called by Supabase Database Webhook on opportunities INSERT.
// Configure in Supabase Dashboard → Database → Webhooks:
//   Table: opportunities | Events: INSERT
//   URL: https://wright-adventures.vercel.app/api/notifications/opportunity-discovered
//   Headers: x-supabase-webhook-secret: <SUPABASE_WEBHOOK_SECRET>
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: validate webhook secret header
  const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET
  if (webhookSecret && req.headers['x-supabase-webhook-secret'] !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const payload = req.body as WebhookPayload
  const { record } = payload

  // Only notify for auto-discovered opportunities with 'discovered' status
  if (record.status !== 'grant_discovered' || !record.auto_discovered) {
    return res.status(200).json({ ok: true, skipped: 'not_auto_discovered' })
  }

  // Fetch all admin users
  const { data: adminProfiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'admin')

  if (profilesError || !adminProfiles?.length) {
    return res.status(200).json({ ok: true, skipped: 'no_admins' })
  }

  const results = {
    sent: 0,
    skipped_opted_out: 0,
    errors: [] as string[],
  }

  // Build the email body once (same for all admins)
  const scoreDisplay = record.ai_match_score != null ? `${record.ai_match_score}/10` : 'Not scored'
  const amountDisplay = record.amount_max != null ? `$${Number(record.amount_max).toLocaleString()}` : 'Not specified'
  const subject = `[Wright Adventures OMP] New grant opportunity: ${record.name}`

  const text = [
    `The discovery pipeline found a potential match for Confluence Colorado.`,
    '',
    `Opportunity: ${record.name}`,
    record.funder ? `Funder: ${record.funder}` : null,
    `Fit Score: ${scoreDisplay}`,
    `Max Funding: ${amountDisplay}`,
    record.primary_deadline ? `Deadline: ${record.primary_deadline}` : null,
    '',
    record.ai_match_rationale ? `Summary: ${record.ai_match_rationale}` : null,
    '',
    `Review and approve: https://wright-adventures.vercel.app/admin/opportunities/${record.id}`,
    '',
    `Update your notification preferences: https://wright-adventures.vercel.app/admin/settings`,
  ].filter(Boolean).join('\n')

  // Send to each admin who hasn't opted out
  for (const adminProfile of adminProfiles) {
    // Check notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('opportunity_discovered')
      .eq('user_id', adminProfile.id)
      .maybeSingle()

    const isEnabled = prefs ? prefs.opportunity_discovered !== false : true
    if (!isEnabled) {
      results.skipped_opted_out++
      continue
    }

    // Fetch admin email
    const { data: { user: admin }, error: userError } = await supabase.auth.admin.getUserById(adminProfile.id)
    if (userError || !admin?.email) continue

    let success = false
    let errorMessage: string | undefined

    try {
      await sendEmail(admin.email, subject, text)
      success = true
      results.sent++
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      results.errors.push(errorMessage)
    }

    // Log the attempt
    await supabase.from('notification_log').insert({
      user_id: adminProfile.id,
      notification_type: 'opportunity_discovered',
      opportunity_id: record.id,
      success,
      error_message: errorMessage ?? null,
      email_to: admin.email,
    })
  }

  return res.status(200).json({ ok: true, ...results })
}
