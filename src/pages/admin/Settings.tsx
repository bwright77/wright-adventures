import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Play, RefreshCw, Radar, Zap, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { NotificationPreference, DiscoverySource, DiscoveryRun } from '../../lib/types'

interface TokenBudget {
  id: string
  monthly_limit: number
  current_period_start: string
  tokens_used: number
  updated_at: string
}


// ── Discovery sources card ────────────────────────────────────
function DiscoverySourcesCard() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runError, setRunError]   = useState<string | null>(null)

  const { data: sources = [], isLoading } = useQuery<DiscoverySource[]>({
    queryKey: ['discovery_sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_sources').select('*').order('source_type').order('label')
      if (error) throw error
      return (data ?? []) as DiscoverySource[]
    },
  })

  const { data: latestRun } = useQuery<DiscoveryRun | null>({
    queryKey: ['discovery_runs', 'latest'],
    queryFn: async () => {
      const { data } = await supabase
        .from('discovery_runs').select('*')
        .order('started_at', { ascending: false }).limit(1).maybeSingle()
      return data as DiscoveryRun | null
    },
    refetchInterval: runningId ? 5_000 : false,
  })

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('discovery_sources')
        // Re-enabling clears the strike count, otherwise one more failure
        // immediately re-disables it.
        .update({ enabled, ...(enabled ? { consecutive_errors: 0, last_error: null } : {}) })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery_sources'] }),
  })

  async function runSource(sourceId: string | null) {
    setRunError(null)
    setRunningId(sourceId ?? 'all')
    try {
      const res = await fetch('/api/discovery/sources-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify(sourceId ? { source_id: sourceId } : {}),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      queryClient.invalidateQueries({ queryKey: ['discovery_sources'] })
      queryClient.invalidateQueries({ queryKey: ['discovery_runs', 'latest'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['token_budget'] })
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunningId(null)
    }
  }

  function StatusDot({ s }: { s: DiscoverySource }) {
    const cls = !s.enabled ? 'bg-gray-300'
      : s.consecutive_errors > 0 ? 'bg-red-400'
      : s.last_fetched_at ? 'bg-green-400'
      : 'bg-amber-400'
    return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cls}`} />
  }

  if (isLoading) {
    return <div className="bg-white rounded-xl border border-gray-200 h-48 animate-pulse" />
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-navy flex items-center gap-1.5">
            <Radar size={14} className="text-river" /> Opportunity Discovery
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Monitored weekly, Mondays at 08:00 UTC. Findings land in Leads.
          </p>
        </div>
        <button
          onClick={() => runSource(null)}
          disabled={runningId !== null}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-800 disabled:opacity-50 transition-colors"
        >
          {runningId === 'all'
            ? <><RefreshCw size={12} className="animate-spin" /> Running…</>
            : <><Play size={12} /> Run all</>}
        </button>
      </div>

      {latestRun && (
        <p className="text-xs text-gray-400 mb-4">
          Last run {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}
          {' · '}{latestRun.status}
          {latestRun.opportunities_inserted > 0 && ` · ${latestRun.opportunities_inserted} added`}
          {latestRun.opportunities_below_threshold > 0 && ` · ${latestRun.opportunities_below_threshold} rejected`}
        </p>
      )}

      {runError && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 mb-3">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />{runError}
        </p>
      )}

      <ul className="divide-y divide-gray-100 -mx-1">
        {sources.map(s => (
          <li key={s.id} className="py-3 px-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <StatusDot s={s} />
                  <span className={`text-sm font-medium truncate ${s.enabled ? 'text-navy' : 'text-gray-400'}`}>
                    {s.label}
                  </span>
                  <span className="text-[0.65rem] uppercase tracking-wide text-gray-400 shrink-0">
                    {s.source_type.replace('_', ' ')}
                  </span>
                  {s.fetch_mode === 'wp_rest' && (
                    <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-river-50 text-river shrink-0">API</span>
                  )}
                </div>
                {s.last_error && (
                  <p className="text-xs text-gray-400 mt-1 ml-3.5 leading-relaxed">{s.last_error}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => runSource(s.id)}
                  disabled={runningId !== null}
                  className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-navy hover:border-navy disabled:opacity-40 transition-colors"
                >
                  {runningId === s.id ? <RefreshCw size={11} className="animate-spin" /> : 'Check now'}
                </button>
                <button
                  onClick={() => toggleEnabled.mutate({ id: s.id, enabled: !s.enabled })}
                  className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-navy hover:border-navy transition-colors"
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── AI spend card ─────────────────────────────────────────────
function TokenBudgetCard() {
  const { data: budget, isLoading } = useQuery<TokenBudget | null>({
    queryKey: ['token_budget'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('token_budgets').select('*')
        .order('current_period_start', { ascending: false }).limit(1).maybeSingle()
      if (error) throw error
      return data as TokenBudget | null
    },
  })

  if (isLoading) return <div className="bg-white rounded-xl border border-gray-200 h-28 animate-pulse" />
  if (!budget) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-400">No usage recorded yet this period.</p>
      </div>
    )
  }

  const used  = Number(budget.tokens_used ?? 0)
  const limit = Number(budget.monthly_limit ?? 0)
  const pct   = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const bar   = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-river'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-navy flex items-center gap-1.5">
            <Zap size={14} className="text-earth" /> AI Usage
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Period starting {budget.current_period_start}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-bold text-navy tabular-nums leading-none">
            {used.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">of {limit.toLocaleString()} tokens</p>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${pct}%` }} />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-3">
        {pct >= 90
          ? <><AlertTriangle size={12} className="text-red-500 shrink-0" /> {pct}% of the monthly budget used</>
          : <><CheckCircle2 size={12} className="text-trail shrink-0" /> {pct}% of the monthly budget used</>}
      </p>
    </div>
  )
}

// ── Notification preferences card ─────────────────────────────
function NotificationPreferencesCard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const queryClient = useQueryClient()

  const { data: prefs, isLoading } = useQuery<NotificationPreference | null>({
    queryKey: ['notification_preferences'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (patch: Partial<NotificationPreference>) => {
      const userId = profile?.id
      if (!userId) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification_preferences'] }),
  })

  const defaultOn = true  // If no prefs row, all notifications are on by default

  const toggles: Array<{
    key: keyof NotificationPreference
    label: string
    description: string
    adminOnly?: boolean
  }> = [
    { key: 'deadline_7d', label: '7-day deadline reminder',  description: 'When a grant deadline is 7 days away' },
    { key: 'deadline_3d', label: '3-day deadline reminder',  description: 'When a grant deadline is 3 days away' },
    { key: 'deadline_1d', label: '1-day deadline reminder',  description: 'When a grant deadline is tomorrow' },
    { key: 'opportunity_discovered', label: 'Lead discovered', description: 'When the discovery pipeline finds a new opportunity worth reviewing', adminOnly: true },
    { key: 'task_assigned', label: 'Task assigned', description: 'When a task is assigned to you' },
  ]

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-32" />
          <div className="h-10 bg-gray-100 rounded w-full" />
          <div className="h-10 bg-gray-100 rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="mt-0.5 p-1.5 bg-gray-50 rounded-lg">
          <Bell size={15} className="text-gray-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-navy mb-0.5">Email Notifications</h2>
          <p className="text-xs text-gray-400">Choose which events send you an email</p>
        </div>
      </div>

      <div className="space-y-1">
        {toggles.filter(t => !t.adminOnly || isAdmin).map(t => {
          const value = prefs ? (prefs[t.key] as boolean) : defaultOn
          return (
            <div key={t.key} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm text-navy">{t.label}</p>
                <p className="text-xs text-gray-400">{t.description}</p>
              </div>
              <button
                role="switch"
                aria-checked={value}
                onClick={() => toggle({ [t.key]: !value })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 focus:outline-none ${
                  value ? 'bg-river' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ${
                    value ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-300 mt-4">
        Emails are sent to your account email address.
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export function Settings() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-navy mb-1">Settings</h1>
      <p className="text-sm text-gray-400 mb-8">Application configuration and usage</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            Notifications
          </h2>
          <NotificationPreferencesCard />
        </section>

        {isAdmin && (
          <>
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
                Discovery
              </h2>
              <DiscoverySourcesCard />
            </section>

            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
                AI Usage
              </h2>
              <TokenBudgetCard />
            </section>
          </>
        )}
      </div>
    </div>
  )
}
