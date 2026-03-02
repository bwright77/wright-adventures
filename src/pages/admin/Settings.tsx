import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw, Play, Square, CheckCircle, XCircle, Clock, Bell, Globe, Pencil, Plus, Trash2 } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { DiscoveryRun, DiscoverySource, NotificationPreference } from '../../lib/types'

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
    { key: 'task_assigned', label: 'Task assigned', description: 'When a task is assigned to you' },
    { key: 'opportunity_discovered', label: 'Opportunity discovered', description: 'When the pipeline finds a new matching grant', adminOnly: true },
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
      const hasActive = query.state.data?.some(r => r.status === 'running' || r.status === 'cancelling')
      return hasActive ? 5_000 : 30_000
    },
  })

  const { mutate: runNow, isPending: isTriggering, error: runError } = useMutation({
    mutationFn: async () => {
      // The sync endpoint returns 202 immediately (the function keeps running server-side).
      // We don't await the full response body — polling picks up the running status.
      const res = await fetch('/api/discovery/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery_runs'] })
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
  const isRunning = latestRun?.status === 'running' || latestRun?.status === 'cancelling' || isTriggering

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
              disabled={isCancelling}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Square size={11} fill="currentColor" />
              {isCancelling ? 'Stopping…' : latestRun?.status === 'cancelling' ? 'Force Stop' : 'Stop'}
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
          <div className="grid grid-cols-5 gap-2">
            {([
              { label: 'Fetched',   value: latestRun.opportunities_fetched,        dim: false },
              { label: 'New',       value: latestRun.opportunities_detail_fetched, dim: false },
              { label: 'Rejected',  value: latestRun.opportunities_auto_rejected,  dim: latestRun.opportunities_auto_rejected === 0 },
              { label: '< 5.0',     value: latestRun.opportunities_below_threshold, dim: latestRun.opportunities_below_threshold === 0 },
              { label: 'Inserted',  value: latestRun.opportunities_inserted,        dim: false },
            ] as const).map(({ label, value, dim }) => (
              <div key={label} className="text-center">
                <p className={`text-base font-bold ${dim ? 'text-gray-300' : 'text-navy'}`}>{value}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-tight">{label}</p>
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

// ── State & Local discovery card ──────────────────────────────

interface SourceFormData {
  label:                  string
  funder_name:            string
  url:                    string
  source_type:            string
  check_frequency:        string
  source_proximity_bonus: string
  eligibility_notes:      string
  relevance_notes:        string
}

const EMPTY_SOURCE_FORM: SourceFormData = {
  label: '', funder_name: '', url: '',
  source_type: 'state', check_frequency: 'weekly',
  source_proximity_bonus: '1.0',
  eligibility_notes: '', relevance_notes: '',
}

function StateDiscoveryCard() {
  const { session } = useAuth()
  const queryClient  = useQueryClient()
  const [checkingId,      setCheckingId]      = useState<string | null>(null)
  const [editingId,       setEditingId]        = useState<string | null>(null) // source.id | 'new' | null
  const [deleteConfirmId, setDeleteConfirmId]  = useState<string | null>(null)
  const [form,            setForm]             = useState<SourceFormData>(EMPTY_SOURCE_FORM)

  const { data: sources = [], isLoading: sourcesLoading } = useQuery<DiscoverySource[]>({
    queryKey: ['discovery_sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_sources')
        .select('*')
        .order('label', { ascending: true })
      if (error) throw error
      return (data ?? []) as DiscoverySource[]
    },
  })

  const { data: stateRuns = [] } = useQuery<DiscoveryRun[]>({
    queryKey: ['discovery_runs', 'state'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_runs')
        .select('*')
        .eq('source_type', 'state')
        .order('started_at', { ascending: false })
        .limit(3)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: query => {
      const hasActive = query.state.data?.some(r => r.status === 'running')
      return hasActive ? 5_000 : 30_000
    },
  })

  const { mutate: runAll, isPending: isRunningAll, error: runAllError } = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/discovery/state-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery_runs', 'state'] })
      queryClient.invalidateQueries({ queryKey: ['discovery_sources'] })
    },
  })

  const { mutate: checkSource, error: checkError } = useMutation({
    mutationFn: async (sourceId: string) => {
      const res = await fetch('/api/discovery/state-sync', {
        method: 'POST',
        headers: {
          Authorization:  `Bearer ${session?.access_token ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ source_id: sourceId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
      }
    },
    onMutate:  (sourceId: string) => setCheckingId(sourceId),
    onSettled: () => {
      setCheckingId(null)
      queryClient.invalidateQueries({ queryKey: ['discovery_sources'] })
      queryClient.invalidateQueries({ queryKey: ['discovery_runs', 'state'] })
    },
  })

  const { mutate: setEnabled } = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const patch: Record<string, unknown> = { enabled }
      if (enabled) { patch.consecutive_errors = 0; patch.last_error = null }
      const { error } = await supabase.from('discovery_sources').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['discovery_sources'] }),
  })

  const { mutate: saveSource, isPending: isSaving, error: saveError } = useMutation({
    mutationFn: async () => {
      const payload = {
        label:                  form.label.trim(),
        funder_name:            form.funder_name.trim(),
        url:                    form.url.trim(),
        source_type:            form.source_type,
        check_frequency:        form.check_frequency,
        source_proximity_bonus: parseFloat(form.source_proximity_bonus) || 1.0,
        eligibility_notes:      form.eligibility_notes.trim() || null,
        relevance_notes:        form.relevance_notes.trim() || null,
      }
      if (editingId === 'new') {
        const { error } = await supabase.from('discovery_sources').insert(payload)
        if (error) throw error
      } else {
        const { error } = await supabase.from('discovery_sources').update(payload).eq('id', editingId!)
        if (error) throw error
      }
    },
    onSuccess: () => {
      setEditingId(null)
      setForm(EMPTY_SOURCE_FORM)
      queryClient.invalidateQueries({ queryKey: ['discovery_sources'] })
    },
  })

  const { mutate: deleteSource } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('discovery_sources').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setDeleteConfirmId(null)
      queryClient.invalidateQueries({ queryKey: ['discovery_sources'] })
    },
  })

  function startEdit(source: DiscoverySource) {
    setDeleteConfirmId(null)
    setForm({
      label:                  source.label,
      funder_name:            source.funder_name,
      url:                    source.url,
      source_type:            source.source_type,
      check_frequency:        source.check_frequency,
      source_proximity_bonus: String(Number(source.source_proximity_bonus)),
      eligibility_notes:      source.eligibility_notes ?? '',
      relevance_notes:        source.relevance_notes ?? '',
    })
    setEditingId(source.id)
  }

  function startAdd() {
    setEditingId('new')
    setForm(EMPTY_SOURCE_FORM)
    setDeleteConfirmId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_SOURCE_FORM)
  }

  function setField(key: keyof SourceFormData, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  const isFormValid = form.label.trim() !== '' && form.url.trim() !== '' && form.funder_name.trim() !== ''

  function nextRunLabel(): string {
    const now  = new Date()
    const day  = now.getUTCDay()
    const hour = now.getUTCHours()
    let ahead = (1 - day + 7) % 7
    if (ahead === 0 && hour >= 8) ahead = 7
    const next = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ahead, 8, 0, 0,
    ))
    return format(next, 'MMM d') + ' at 8:00 AM UTC'
  }

  const latestRun = stateRuns[0]
  const isRunning = latestRun?.status === 'running' || isRunningAll
  const isBusy    = isRunning || !!checkingId

  function SourceStatusDot({ source }: { source: DiscoverySource }) {
    if (!source.enabled)               return <div className="w-2 h-2 rounded-full bg-red-400 shrink-0 mt-1.5" />
    if (source.consecutive_errors > 0) return <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1.5" />
    return                                    <div className="w-2 h-2 rounded-full bg-green-400 shrink-0 mt-1.5" />
  }

  // ── Inline source form (used for both add and edit) ───────────
  function SourceForm({ title }: { title: string }) {
    const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20 bg-white'
    return (
      <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/60">
        <p className="text-xs font-semibold text-navy">{title}</p>

        {saveError && (
          <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
            <XCircle size={12} className="shrink-0" />
            {(saveError as Error).message}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Label *</label>
            <input type="text" value={form.label} onChange={e => setField('label', e.target.value)}
              placeholder="GOCO — Grant Programs" className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Funder Name *</label>
            <input type="text" value={form.funder_name} onChange={e => setField('funder_name', e.target.value)}
              placeholder="Great Outdoors Colorado" className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">URL *</label>
          <input type="url" value={form.url} onChange={e => setField('url', e.target.value)}
            placeholder="https://…" className={inputCls} />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Type</label>
            <select value={form.source_type} onChange={e => setField('source_type', e.target.value)} className={inputCls}>
              <option value="state">State</option>
              <option value="local">Local</option>
              <option value="foundation">Foundation</option>
              <option value="federal_api">Federal API</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Frequency</label>
            <select value={form.check_frequency} onChange={e => setField('check_frequency', e.target.value)} className={inputCls}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Proximity Bonus</label>
            <input type="number" min="0" max="10" step="0.1"
              value={form.source_proximity_bonus}
              onChange={e => setField('source_proximity_bonus', e.target.value)}
              className={inputCls} />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Eligibility Notes</label>
          <textarea value={form.eligibility_notes} onChange={e => setField('eligibility_notes', e.target.value)}
            placeholder="Who can apply, partnership requirements…"
            className={`${inputCls} resize-none`} rows={2} />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Relevance Notes</label>
          <textarea value={form.relevance_notes} onChange={e => setField('relevance_notes', e.target.value)}
            placeholder="Specific programs, past applications, alignment notes…"
            className={`${inputCls} resize-none`} rows={2} />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => saveSource()}
            disabled={isSaving || !isFormValid}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-river hover:bg-river/90 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            {isSaving ? 'Saving…' : editingId === 'new' ? 'Add Source' : 'Save Changes'}
          </button>
          <button
            onClick={cancelEdit}
            className="text-xs text-gray-500 hover:text-navy px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  if (sourcesLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-40" />
          <div className="h-12 bg-gray-100 rounded w-full" />
          <div className="h-12 bg-gray-100 rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 p-1.5 bg-gray-50 rounded-lg">
            <Globe size={15} className="text-gray-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-navy">State & Local Sources</h2>
            <p className="text-xs text-gray-400">
              {sources.length} source{sources.length !== 1 ? 's' : ''} · Page monitoring
            </p>
          </div>
        </div>
        {isRunning ? (
          <span className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
            <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            Running…
          </span>
        ) : (
          <button
            onClick={() => runAll()}
            disabled={isBusy}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-river hover:bg-river/90 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Play size={12} /> Run All
          </button>
        )}
      </div>

      {/* Next run */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-4 ml-9">
        <Clock size={11} className="text-gray-300 shrink-0" />
        Next: {nextRunLabel()}
      </div>

      {/* Run / check errors */}
      {(runAllError || checkError) && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          <XCircle size={13} className="shrink-0" />
          {((runAllError ?? checkError) as Error).message}
        </div>
      )}

      {/* Latest state run summary */}
      {latestRun && (
        <div className={`rounded-lg p-3 mb-4 border text-xs ${
          latestRun.status === 'running'   ? 'bg-blue-50 border-blue-100' :
          latestRun.status === 'completed' ? 'bg-green-50 border-green-100' :
                                            'bg-red-50 border-red-100'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {latestRun.status === 'running'   && <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
              {latestRun.status === 'completed' && <CheckCircle size={13} className="text-green-500" />}
              {latestRun.status === 'failed'    && <XCircle size={13} className="text-red-500" />}
              <span className="font-medium text-navy capitalize">
                {latestRun.status === 'running' ? 'Running' : 'Last run'}
                {' · '}{latestRun.triggered_by}
              </span>
            </div>
            <span className="text-gray-400">
              {formatDistanceToNow(new Date(latestRun.started_at), { addSuffix: true })}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {([
              { label: 'Candidates', value: latestRun.opportunities_fetched },
              { label: 'Dupes',      value: latestRun.opportunities_deduplicated },
              { label: '< 5.0',      value: latestRun.opportunities_below_threshold },
              { label: 'Inserted',   value: latestRun.opportunities_inserted },
            ] as const).map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-sm font-bold text-navy">{value}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wide leading-tight">{label}</p>
              </div>
            ))}
          </div>
          {latestRun.error_log && latestRun.error_log.length > 0 && (
            <p className="text-red-600 mt-2">
              {latestRun.error_log.length} error{latestRun.error_log.length > 1 ? 's' : ''} during run
            </p>
          )}
        </div>
      )}

      {/* Source list */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] mb-3">
          Monitored Sources
        </p>

        <div className="space-y-0">
          {sources.map(source => {
            const isChecking   = checkingId === source.id
            const isEditing    = editingId === source.id
            const isConfirming = deleteConfirmId === source.id
            const hasErrors    = source.consecutive_errors > 0
            const isDisabled   = !source.enabled

            // Edit mode: replace row with inline form
            if (isEditing) {
              return (
                <div key={source.id} className="py-2">
                  <SourceForm title={`Edit: ${source.label}`} />
                </div>
              )
            }

            return (
              <div key={source.id} className={`flex items-start justify-between gap-3 py-3 border-b border-gray-50 last:border-0 ${isDisabled ? 'opacity-70' : ''}`}>
                <div className="flex items-start gap-2.5 min-w-0">
                  <SourceStatusDot source={source} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-navy leading-snug">{source.label}</span>
                      {isDisabled && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-red-500 bg-red-50 px-1.5 py-0.5 rounded">
                          Disabled
                        </span>
                      )}
                      {!isDisabled && hasErrors && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                          <AlertTriangle size={9} />
                          {source.consecutive_errors}/3 errors
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{source.funder_name}</p>
                    <a href={source.url} target="_blank" rel="noreferrer"
                      className="text-xs text-gray-300 hover:text-river truncate block max-w-xs transition-colors"
                      title={source.url}>
                      {source.url.replace(/^https?:\/\//, '')}
                    </a>
                    {source.last_fetched_at ? (
                      <p className="text-xs text-gray-300">
                        Checked {formatDistanceToNow(new Date(source.last_fetched_at), { addSuffix: true })}
                        {source.last_changed_at && (
                          <> · Changed {formatDistanceToNow(new Date(source.last_changed_at), { addSuffix: true })}</>
                        )}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-300">Never checked</p>
                    )}
                    {source.last_error && (
                      <p className="text-xs text-red-400 truncate max-w-xs" title={source.last_error}>
                        {source.last_error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isConfirming ? (
                    // Inline delete confirmation
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-red-600">Delete?</span>
                      <button
                        onClick={() => deleteSource(source.id)}
                        className="text-xs font-medium text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-gray-500 hover:text-navy px-2 py-1 rounded hover:bg-gray-50 transition-colors"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <>
                      {isDisabled ? (
                        <button onClick={() => setEnabled({ id: source.id, enabled: true })}
                          className="text-xs text-gray-500 hover:text-navy px-2 py-1 rounded hover:bg-gray-50 transition-colors">
                          Re-enable
                        </button>
                      ) : (
                        <button onClick={() => setEnabled({ id: source.id, enabled: false })}
                          className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-gray-50 transition-colors">
                          Disable
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(source)}
                        disabled={isBusy}
                        title="Edit source"
                        className="p-1.5 text-gray-400 hover:text-navy disabled:opacity-40 rounded hover:bg-gray-50 transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => { setDeleteConfirmId(source.id); setEditingId(null) }}
                        disabled={isBusy}
                        title="Delete source"
                        className="p-1.5 text-gray-300 hover:text-red-500 disabled:opacity-40 rounded hover:bg-gray-50 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={() => checkSource(source.id)}
                        disabled={isBusy}
                        className="flex items-center gap-1 text-xs font-medium text-river hover:bg-river/5 disabled:opacity-40 px-2.5 py-1.5 rounded-lg border border-river/20 transition-colors whitespace-nowrap"
                      >
                        {isChecking
                          ? <><div className="w-3 h-3 border border-river border-t-transparent rounded-full animate-spin" /> Checking…</>
                          : <><Play size={10} /> Check Now</>
                        }
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {sources.length === 0 && editingId !== 'new' && (
          <p className="text-sm text-gray-400 text-center py-2">No sources configured.</p>
        )}

        {/* Add source form */}
        {editingId === 'new' && (
          <div className="mt-2">
            <SourceForm title="Add New Source" />
          </div>
        )}

        {/* Add source button */}
        {editingId !== 'new' && (
          <button
            onClick={startAdd}
            disabled={isBusy || editingId !== null}
            className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 hover:text-navy disabled:opacity-40 hover:bg-gray-50 px-2 py-1.5 rounded-lg transition-colors w-full justify-center border border-dashed border-gray-200 hover:border-gray-300"
          >
            <Plus size={12} /> Add Source
          </button>
        )}
      </div>
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
                Grant Discovery
              </h2>
              <div className="space-y-4">
                <DiscoveryCard />
                <StateDiscoveryCard />
              </div>
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
