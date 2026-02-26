import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Play, Square, CheckCircle, XCircle, Clock } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { DiscoveryRun } from '../../lib/types'

interface UsageData {
  period_start: string
  monthly_limit: number
  tokens_used: number
  percent_used: number
  updated_at: string | null
}

// ── Token budget card ─────────────────────────────────────────
function TokenBudgetCard() {
  const { session } = useAuth()
  const queryClient  = useQueryClient()
  const [editLimit, setEditLimit] = useState('')
  const [editing, setEditing]     = useState(false)

  const { data: usage, isLoading } = useQuery<UsageData>({
    queryKey: ['ai_usage'],
    queryFn: async () => {
      const res = await fetch('/api/ai/usage', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) throw new Error('Failed to fetch usage')
      return res.json()
    },
    refetchInterval: 60_000,
  })

  const { mutate: updateLimit, isPending } = useMutation({
    mutationFn: async (newLimit: number) => {
      const { error } = await supabase
        .from('token_budgets')
        .update({ monthly_limit: newLimit, updated_at: new Date().toISOString() })
        .eq('current_period_start', usage?.period_start ?? '')
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['ai_usage'] })
    },
  })

  function handleSaveLimit() {
    const val = parseInt(editLimit, 10)
    if (isNaN(val) || val < 1000) return
    updateLimit(val)
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-32" />
          <div className="h-8 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
      </div>
    )
  }

  if (!usage) return null

  const pct          = usage.percent_used
  const barColor     = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-river'
  const formattedPct = Math.min(pct, 100)
  const approxCost   = ((usage.tokens_used / 1_000_000) * 3).toFixed(2)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-navy mb-1">Monthly Token Budget</h2>
          <p className="text-xs text-gray-400">
            Period: {usage.period_start}
            {usage.updated_at && (
              <> · Updated {new Date(usage.updated_at).toLocaleTimeString()}</>
            )}
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['ai_usage'] })}
          className="p-1.5 text-gray-400 hover:text-navy rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>{usage.tokens_used.toLocaleString()} tokens used</span>
          <span>{usage.monthly_limit.toLocaleString()} limit</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${formattedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className={`font-medium ${pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-gray-600'}`}>
            {pct}% consumed
          </span>
          <span className="text-gray-400">≈ ${approxCost} this month</span>
        </div>
      </div>

      {pct >= 80 && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            Token usage is above 80%. Consider increasing the limit or asking team to start new chat sessions.
          </span>
        </div>
      )}

      <div className="border-t border-gray-100 pt-4">
        {editing ? (
          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
            <input
              type="number"
              value={editLimit}
              onChange={e => setEditLimit(e.target.value)}
              placeholder="e.g. 1000000"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
            />
            <button
              onClick={handleSaveLimit}
              disabled={isPending}
              className="text-sm bg-river text-white px-4 py-2 rounded-lg hover:bg-river/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setEditLimit(String(usage.monthly_limit)); setEditing(true) }}
            className="text-xs text-river hover:underline"
          >
            Change monthly limit
          </button>
        )}
      </div>
    </div>
  )
}

// ── Discovery card ────────────────────────────────────────────
function DiscoveryCard() {
  const { session }  = useAuth()
  const queryClient  = useQueryClient()

  const { data: runs = [], isLoading } = useQuery<DiscoveryRun[]>({
    queryKey: ['discovery_runs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: (query) => {
      const hasActive = query.state.data?.some(r => r.status === 'running')
      return hasActive ? 5_000 : 30_000
    },
  })

  const { mutate: runNow, isPending: isTriggering, error: runError } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/discovery/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery_runs'] })
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
  })

  const { mutate: cancelRun, isPending: isCancelling } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/discovery/cancel', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery_runs'] }),
  })

  function nextRunTime(): string {
    const now  = new Date()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0))
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    return format(next, 'MMM d') + ' at 7:00 AM UTC'
  }

  const latestRun = runs[0]
  const isRunning = latestRun?.status === 'running' || isTriggering

  function RunStatusIcon({ status }: { status: DiscoveryRun['status'] }) {
    if (status === 'running')    return <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
    if (status === 'cancelling') return <div className="w-3.5 h-3.5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin shrink-0" />
    if (status === 'completed')  return <CheckCircle size={14} className="text-green-500 shrink-0" />
    if (status === 'cancelled')  return <Square size={14} className="text-gray-400 shrink-0" fill="currentColor" />
    return <XCircle size={14} className="text-red-500 shrink-0" />
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-32" />
          <div className="h-20 bg-gray-100 rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-navy mb-1">Grant Discovery</h2>
          <p className="text-xs text-gray-400">Simpler.Grants.gov · 9 active queries</p>
        </div>
        {isRunning ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Running…
            </span>
            <button
              onClick={() => cancelRun()}
              disabled={isCancelling || latestRun?.status === 'cancelling'}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Square size={11} fill="currentColor" />
              {isCancelling || latestRun?.status === 'cancelling' ? 'Stopping…' : 'Stop'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => runNow()}
            disabled={isRunning}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-river hover:bg-river/90 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Play size={12} /> Run Now
          </button>
        )}
      </div>

      {runError && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          <XCircle size={13} />
          {(runError as Error).message}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-400 mb-5">
        <Clock size={12} className="text-gray-300 shrink-0" />
        Next: {nextRunTime()}
      </div>

      {/* Latest run summary */}
      {latestRun && (
        <div className={`rounded-lg p-4 mb-4 border ${
          latestRun.status === 'running'    ? 'bg-blue-50 border-blue-100' :
          latestRun.status === 'cancelling' ? 'bg-orange-50 border-orange-100' :
          latestRun.status === 'cancelled'  ? 'bg-gray-50 border-gray-200' :
          latestRun.status === 'completed'  ? 'bg-green-50 border-green-100' :
                                              'bg-red-50 border-red-100'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RunStatusIcon status={latestRun.status} />
              <span className="text-xs font-medium text-navy capitalize">
                {latestRun.status === 'running'    ? 'Running'
                 : latestRun.status === 'cancelling' ? 'Stopping'
                 : latestRun.status === 'cancelled'  ? 'Stopped'
                 : 'Last run'} · {latestRun.triggered_by}
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { label: 'Fetched',  value: latestRun.opportunities_fetched },
              { label: 'New',      value: latestRun.opportunities_detail_fetched },
              { label: 'Inserted', value: latestRun.opportunities_inserted },
            ] as const).map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-lg font-bold text-navy">{value}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide">{label}</p>
              </div>
            ))}
          </div>
          {latestRun.error_log && latestRun.error_log.length > 0 && (
            <p className="text-xs text-red-600 mt-3">
              {latestRun.error_log.length} error{latestRun.error_log.length > 1 ? 's' : ''} during run
            </p>
          )}
        </div>
      )}

      {/* Run history */}
      {runs.length > 1 && (
        <div className="border-t border-gray-100 pt-4 space-y-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-[0.07em] mb-2">Previous runs</p>
          {runs.slice(1).map(run => (
            <div key={run.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <RunStatusIcon status={run.status} />
                <span className="text-gray-500 capitalize">{run.triggered_by}</span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{run.opportunities_inserted} inserted</span>
              </div>
              <span className="text-gray-300">
                {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      )}

      {runs.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-2">
          No runs yet. Click Run Now to start the first sync.
        </p>
      )}
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

      {isAdmin ? (
        <div className="space-y-8">
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
              Grant Discovery
            </h2>
            <DiscoveryCard />
          </section>

          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
              AI Usage
            </h2>
            <TokenBudgetCard />
          </section>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">
            Settings are only visible to administrators.
          </p>
        </div>
      )}
    </div>
  )
}
