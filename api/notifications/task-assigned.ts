import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from './_mailer'

// ── Supabase (service role — server-side only) ────────────────
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Supabase Database Webhook payload shape for the tasks table
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: {
    id: string
    opportunity_id: string | null
    title: string
    description: string | null
    assigned_to: string | null
    due_date: string | null
    status: string
  }
  old_record: {
    id: string
    assigned_to: string | null
  } | null
}

// ── Handler ───────────────────────────────────────────────────
// POST — called by Supabase Database Webhook on tasks INSERT/UPDATE.
// Configure in Supabase Dashboard → Database → Webhooks:
//   Table: tasks | Events: INSERT, UPDATE
//   URL: https://wright-adventures.vercel.app/api/notifications/task-assigned
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

  const { record, old_record } = payload

  // Only notify when assigned_to is newly set:
  //   - INSERT with an assignee, OR
  //   - UPDATE where assignee changed (reassignment)
  if (!record.assigned_to) {
    return res.status(200).json({ ok: true, skipped: 'no_assignee' })
  }
  if (old_record && old_record.assigned_to === record.assigned_to) {
    return res.status(200).json({ ok: true, skipped: 'assignee_unchanged' })
  }

  // Check notification preferences for assignee
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('task_assigned')
    .eq('user_id', record.assigned_to)
    .maybeSingle()

  const isEnabled = prefs ? prefs.task_assigned !== false : true
  if (!isEnabled) {
    return res.status(200).json({ ok: true, skipped: 'opted_out' })
  }

  // Fetch assignee email
  const { data: { user: assignee }, error: userError } = await supabase.auth.admin.getUserById(record.assigned_to)
  if (userError || !assignee?.email) {
    return res.status(200).json({ ok: true, skipped: 'user_not_found' })
  }

  // Fetch opportunity name if linked
  let opportunityName = 'an opportunity'
  if (record.opportunity_id) {
    const { data: opp } = await supabase
      .from('opportunities')
      .select('name')
      .eq('id', record.opportunity_id)
      .single()
    if (opp?.name) opportunityName = opp.name
  }

  // Build and send email
  const subject = `[Wright Adventures OMP] New task assigned: ${record.title}`
  const text = [
    `You've been assigned a task on ${opportunityName}:`,
    '',
    `Task: ${record.title}`,
    `Due: ${record.due_date ?? 'No due date set'}`,
    `Opportunity: ${opportunityName}`,
    '',
    record.opportunity_id
      ? `View task: ${process.env.APP_URL}/admin/opportunities/${record.opportunity_id}`
      : null,
    '',
    `Update your notification preferences: ${process.env.APP_URL}/admin/settings`,
  ].filter(Boolean).join('\n')

  let success = false
  let errorMessage: string | undefined

  try {
    await sendEmail(assignee.email, subject, text)
    success = true
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  // Log the attempt
  await supabase.from('notification_log').insert({
    user_id: record.assigned_to,
    notification_type: 'task_assigned',
    opportunity_id: record.opportunity_id ?? null,
    task_id: record.id,
    success,
    error_message: errorMessage ?? null,
    email_to: assignee.email,
  })

  return res.status(200).json({ ok: true, sent: success, error: errorMessage })
}
