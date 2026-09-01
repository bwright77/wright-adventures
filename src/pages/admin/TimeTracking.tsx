import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { parseDuration, formatDuration, retainerStatus } from '../../lib/retainer'
import type { LedgerRow, PeriodRow } from '../../lib/retainer'

/**
 * Logging time (ADR-010 Phase 1).
 *
 * The retainer panel sits beside the form rather than on another screen because
 * the number that matters — how much of the commitment is gone — is the one you
 * want in front of you while deciding whether to log the hour honestly.
 *
 * Time is stored as integer minutes. The input accepts what people actually
 * type: "2.5", "90m", "1:30". A bare number means hours.
 */

interface EngagementRow {
  id: string
  name: string
  billing_model: string
  contract_rate: number | string | null
  standard_rate: number | string | null
  committed_hours: number | string | null
  hours_per_period: number | string | null
  max_hours_per_period: number | string | null
  started_on: string | null
  ended_on: string | null
  organizations: { name: string } | null
}

interface EntryRow {
  id: string
  entry_date: string
  minutes: number
  description: string
  billable: boolean
  engagement_id: string
}

const QUICK = [15, 30, 60, 90, 120]

export function TimeTracking() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const today = new Date()

  const [engagementId, setEngagementId] = useState<string>('')
  const [entryDate, setEntryDate] = useState(() => today.toISOString().slice(0, 10))
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [billable, setBillable] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: engagements = [] } = useQuery<EngagementRow[]>({
    queryKey: ['engagements', 'loggable'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('engagements')
        .select('id, name, billing_model, contract_rate, standard_rate, committed_hours, hours_per_period, max_hours_per_period, started_on, ended_on, organizations(name)')
        .neq('delivery_status', 'complete')
        .order('created_at', { ascending: false })
      if (e) throw e
      return (data ?? []) as unknown as EngagementRow[]
    },
  })

  // Default to the first engagement once they load.
  const selected = engagements.find(x => x.id === engagementId) ?? engagements[0]
  const activeId = selected?.id ?? ''

  const { data: entries = [] } = useQuery<EntryRow[]>({
    queryKey: ['time_entries', activeId],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('time_entries').select('*')
        .eq('engagement_id', activeId)
        .order('entry_date', { ascending: false }).order('created_at', { ascending: false })
      if (e) throw e
      return (data ?? []) as EntryRow[]
    },
    enabled: !!activeId,
  })

  const { data: ledger = [] } = useQuery<LedgerRow[]>({
    queryKey: ['retainer_ledger', activeId],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('retainer_ledger').select('entry_type, hours, created_at').eq('engagement_id', activeId)
      if (e) throw e
      return (data ?? []) as LedgerRow[]
    },
    enabled: !!activeId,
  })

  const { data: periods = [] } = useQuery<PeriodRow[]>({
    queryKey: ['retainer_periods', activeId],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('retainer_periods').select('period_number, period_start, period_end, hours_granted, fee, status')
        .eq('engagement_id', activeId).order('period_number')
      if (e) throw e
      return (data ?? []) as PeriodRow[]
    },
    enabled: !!activeId,
  })

  const minutes = parseDuration(duration)
  const isRetainer = selected?.billing_model === 'retainer'
  const status = selected && isRetainer
    ? retainerStatus(selected, ledger, periods, entries, today)
    : null

  const log = useMutation({
    mutationFn: async () => {
      if (!minutes || !activeId) return
      const { error: e } = await supabase.from('time_entries').insert({
        engagement_id: activeId,
        user_id: profile?.id ?? null,
        entry_date: entryDate,
        minutes,
        description: description.trim(),
        billable,
      })
      if (e) throw e
    },
    onSuccess: () => {
      setDuration(''); setDescription(''); setError(null)
      queryClient.invalidateQueries({ queryKey: ['time_entries', activeId] })
      queryClient.invalidateQueries({ queryKey: ['retainer_ledger', activeId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.from('time_entries').delete().eq('id', id)
      if (e) throw e
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time_entries', activeId] })
      queryClient.invalidateQueries({ queryKey: ['retainer_ledger', activeId] })
    },
  })

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20'
  const todayMinutes = entries.filter(e => e.entry_date === today.toISOString().slice(0, 10))
    .reduce((s, e) => s + e.minutes, 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Time</h1>
        <p className="text-sm text-gray-600 mt-0.5">
          {todayMinutes ? `${formatDuration(todayMinutes)} logged today` : 'Nothing logged today'}
        </p>
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Engagement</label>
                <select className={inputCls} value={activeId} onChange={e => setEngagementId(e.target.value)}>
                  {engagements.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.organizations?.name ?? '—'} · {e.name}
                      {e.billing_model === 'non_billable' ? ' (contributed)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid sm:grid-cols-[140px_1fr] gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Date</label>
                  <input type="date" className={inputCls} value={entryDate} onChange={e => setEntryDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                    How long? <span className="font-normal text-gray-500 normal-case">— 2.5, 90m, or 1:30</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      value={duration}
                      onChange={e => setDuration(e.target.value)}
                      placeholder="2.5"
                    />
                    <div className="flex gap-1 shrink-0">
                      {QUICK.map(m => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDuration(formatDuration(m))}
                          className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-600 hover:border-river hover:text-river-700 transition-colors"
                        >
                          {formatDuration(m)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {duration && minutes == null && (
                    <p className="text-xs text-red-600 mt-1">Not a duration I can read.</p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">What did you do?</label>
                <input
                  className={inputCls}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Extract and assess the current marketing cloud data"
                  onKeyDown={e => { if (e.key === 'Enter' && minutes && description.trim()) log.mutate() }}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="rounded" />
                  Billable
                  {!billable && <span className="text-xs text-gray-500">— logged, but does not draw the retainer</span>}
                </label>
                <button
                  onClick={() => { setError(null); log.mutate() }}
                  disabled={!minutes || !description.trim() || log.isPending}
                  className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
                >
                  {log.isPending ? 'Logging…' : minutes ? `Log ${formatDuration(minutes)}` : 'Log time'}
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4">
              <h2 className="text-sm font-semibold text-navy">Recent entries</h2>
            </div>
            {entries.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-gray-500">Nothing logged against this engagement yet.</p>
            ) : (
              <ul>
                {entries.slice(0, 20).map(e => (
                  <li key={e.id} className="flex items-center gap-4 px-6 py-3 border-t border-gray-100 group">
                    <span className="text-xs text-gray-600 tabular-nums w-20 shrink-0">
                      {format(new Date(e.entry_date + 'T00:00:00'), 'MMM d')}
                    </span>
                    <span className="text-sm font-semibold text-navy tabular-nums w-16 shrink-0">
                      {formatDuration(e.minutes)}
                    </span>
                    <span className="text-sm text-gray-600 flex-1 min-w-0 truncate">{e.description}</span>
                    {!e.billable && (
                      <span className="text-[0.7rem] uppercase tracking-wide text-gray-500 shrink-0">contributed</span>
                    )}
                    <button
                      onClick={() => remove.mutate(e.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all shrink-0"
                      aria-label="Delete entry"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {status && selected && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-navy mb-1">Retainer</h2>
            <p className="text-xs text-gray-600 mb-5">{selected.organizations?.name}</p>

            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-3xl font-bold text-navy tabular-nums">{status.balance.toFixed(1)}</span>
                <span className="text-xs text-gray-600">of {status.committed} hours left</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-river transition-all"
                  style={{ width: `${Math.min(100, (status.hoursUsed / (status.committed || 1)) * 100)}%` }}
                />
              </div>
            </div>

            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-600">This month</dt>
                <dd className={`tabular-nums font-medium ${status.overCeiling ? 'text-red-600' : 'text-navy'}`}>
                  {status.drawnThisMonth.toFixed(1)} / {status.monthlyCeiling} max
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Invoiced</dt>
                <dd className="tabular-nums font-medium text-navy">${status.invoicedToDate.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Effective rate</dt>
                <dd className="tabular-nums font-medium text-navy">
                  {status.effectiveRate == null ? '—' : `$${Math.round(status.effectiveRate)}/hr`}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Contract rate</dt>
                <dd className="tabular-nums text-gray-600">${Number(selected.contract_rate ?? 0)}/hr</dd>
              </div>
            </dl>

            {status.overCeiling && (
              <p className="mt-4 flex gap-2 text-xs text-red-600 leading-relaxed">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Past the {status.monthlyCeiling}-hour monthly ceiling. Drawing ahead is allowed up to
                it; beyond needs written approval before the work is done.
              </p>
            )}

            {/* Straight-line, and the SOW front-loads Phase 1 — so this reads as
                an overrun in month one even when the plan is being followed. */}
            {status.projectedHours != null && status.onPaceToOverrun && !status.overCeiling && (
              <p className="mt-4 text-xs text-gray-600 leading-relaxed">
                At this rate the term projects to {Math.round(status.projectedHours)} hours against
                {' '}{status.committed} committed. Phase 1 is planned front-loaded, so expect this
                early.
              </p>
            )}
          </div>
        )}

        {selected && !isRetainer && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-navy mb-1">Contributed work</h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              This engagement is {selected.billing_model.replace('_', '-')}. Hours are logged so the
              value is measured rather than estimated — they are never invoiced.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
