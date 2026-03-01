import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_mailer'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Terminal statuses — do not send deadline reminders for these
const TERMINAL_STATUSES = [
  'grant_awarded', 'grant_declined', 'grant_withdrawn', 'grant_archived',
  'partnership_completed', 'partnership_declined', 'partnership_archived',
]

type DeadlineThreshold = 'deadline_7d' | 'deadline_3d' | 'deadline_1d'

const THRESHOLD_DAYS: Record<DeadlineThreshold, number> = {
  deadline_7d: 7,
  deadline_3d: 3,
  deadline_1d: 1,
}

// ── Handler ───────────────────────────────────────────────────
// GET with Authorization: Bearer <CRON_SECRET> — triggered by Vercel Cron at 9:00 AM UTC
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.authorization ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const results = {
    checked: 0,
    sent: 0,
    skipped_dedup: 0,
    skipped_opted_out: 0,
    skipped_no_owner: 0,
    errors: [] as Array<{ opportunity_id: string; error: string }>,
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  // Check all three thresholds
  for (const [type, days] of Object.entries(THRESHOLD_DAYS) as Array<[DeadlineThreshold, number]>) {
    const targetDate = new Date(today)
    targetDate.setUTCDate(today.getUTCDate() + days)
    const targetDateStr = targetDate.toISOString().split('T')[0]

    // Fetch opportunities with deadline on this target date, not in terminal status
    const { data: opportunities, error: fetchError } = await supabase
      .from('opportunities')
      .select('id, name, funder, status, owner_id, primary_deadline')
      .eq('primary_deadline', targetDateStr)
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
      .not('owner_id', 'is', null)

    if (fetchError) {
      results.errors.push({ opportunity_id: 'query', error: fetchError.message })
      continue
    }

    if (!opportunities?.length) continue

    for (const opp of opportunities) {
      results.checked++

      // Check dedup: has this notification already been sent successfully today?
      const todayStr = today.toISOString().split('T')[0]  // YYYY-MM-DD UTC
      const { data: existing } = await supabase
        .from('notification_log')
        .select('id')
        .eq('opportunity_id', opp.id)
        .eq('notification_type', type)
        .eq('sent_date', todayStr)
        .eq('success', true)
        .limit(1)
        .maybeSingle()

      if (existing) {
        results.skipped_dedup++
        continue
      }

      // Check notification preferences for owner
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select(type)
        .eq('user_id', opp.owner_id)
        .maybeSingle()

      // If no preferences row exists, default to enabled
      const isEnabled = prefs ? (prefs as Record<string, boolean>)[type] !== false : true
      if (!isEnabled) {
        results.skipped_opted_out++
        continue
      }

      // Fetch owner email
      const { data: { user: owner }, error: userError } = await supabase.auth.admin.getUserById(opp.owner_id)
      if (userError || !owner?.email) {
        results.skipped_no_owner++
        continue
      }

      // Build and send email
      const daysLabel = days === 1 ? '1 day' : `${days} days`
      const subject = `[Wright Adventures OMP] Deadline in ${daysLabel}: ${opp.name}`
      const text = [
        `${opp.name} is due in ${daysLabel}.`,
        '',
        `Deadline: ${opp.primary_deadline}`,
        opp.funder ? `Funder: ${opp.funder}` : null,
        `Status: ${opp.status}`,
        '',
        `View opportunity: ${process.env.APP_URL}/admin/opportunities/${opp.id}`,
        '',
        `You're receiving this because you're the owner of this opportunity.`,
        `Update your notification preferences: ${process.env.APP_URL}/admin/settings`,
      ].filter(Boolean).join('\n')

      let success = false
      let errorMessage: string | undefined

      try {
        await sendEmail(owner.email, subject, text)
        success = true
        results.sent++
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err)
        results.errors.push({ opportunity_id: opp.id, error: errorMessage })
      }

      // Write to notification_log
      await supabase.from('notification_log').insert({
        user_id: opp.owner_id,
        notification_type: type,
        opportunity_id: opp.id,
        sent_date: today.toISOString().split('T')[0],
        success,
        error_message: errorMessage ?? null,
        email_to: owner.email,
      })
    }
  }

  return res.status(200).json({ ok: true, ...results })
}
