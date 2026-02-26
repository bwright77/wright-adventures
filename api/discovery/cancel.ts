import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function isAdminJwt(jwt: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser(jwt)
  if (!user) return false
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return profile?.role === 'admin'
}

// POST /api/discovery/cancel
// Signals the currently running discovery sync to stop after its current iteration.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ') || !await isAdminJwt(authHeader.slice(7))) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Find the most recent running run
  const { data: run } = await supabase
    .from('discovery_runs')
    .select('id')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!run) {
    return res.status(404).json({ error: 'No running discovery run found' })
  }

  const { error } = await supabase
    .from('discovery_runs')
    .update({ status: 'cancelling' })
    .eq('id', run.id)

  if (error) {
    return res.status(500).json({ error: 'Failed to signal cancellation' })
  }

  return res.status(200).json({ run_id: run.id, status: 'cancelling' })
}
