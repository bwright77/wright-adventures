import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Pencil, AlertTriangle, FileDown } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { todayLocal, monthStartLocal, monthEndLocal } from '../../lib/dates'
import { Stopwatch, useStopwatch } from '../../components/admin/Stopwatch'
import { EntryEditDialog } from '../../components/admin/EntryEditDialog'
import { parseBillable, parseDuration, formatHours, retainerStatus, billingLabel } from '../../lib/retainer'
import type { LedgerRow, PeriodRow } from '../../lib/retainer'

/**
 * Logging time (ADR-010 Phase 1).
 *
 * The retainer panel sits beside the form rather than on another screen because
 * the number that matters — how much of the commitment is gone — is the one you
 * want in front of you while deciding whether to log the hour honestly.
 *
 * Time bills in six-minute increments — tenths of an hour — always rounded UP:
 * five minutes on the timer is 0.1, seven is 0.2. The input accepts what people
 * actually type ("2.5", "90m", "1:30", a bare number meaning hours) and shows
 * the rounding as you type, so it is never a surprise on the invoice.
 */

interface EngagementRow {
  id: string
  name: string
  nature: string
  billing_model: string
  contract_rate: number | string | null
  contract_value: number | string | null
  standard_rate: number | string | null
  committed_hours: number | string | null
  hours_per_period: number | string | null
  max_hours_per_period: number | string | null
  started_on: string | null
  ended_on: string | null
  organizations: { name: string; logo_url: string | null } | null
}

interface EntryRow {
  id: string
  entry_date: string
  minutes: number
  description: string
  billable: boolean
  is_estimate: boolean
  engagement_id: string
  user_id: string | null
  locked: boolean
}

interface ProfileRow {
  id: string
  full_name: string
}

/** First name, for a compact byline on an entry. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** Initials, for an organisation with no logo on file. */
function initials(name: string): string {
  return name.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w[0] ?? '')).slice(0, 2)
    .map(w => w[0]!.toUpperCase()).join('') || '—'
}

/** Tenths of an hour, the unit that is billed. */
const QUICK = [6, 30, 60, 90, 120]

export function TimeTracking() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const today = new Date()

  // Arriving from the dashboard's Work in Flight list preselects the engagement.
  const [searchParams] = useSearchParams()
  const [engagementId, setEngagementId] = useState<string>(() => searchParams.get('engagement') ?? '')
  const [entryDate, setEntryDate] = useState(todayLocal)
  const [duration, setDuration] = useState('')
  const [description, setDescription] = useState('')
  const [billable, setBillable] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'timer' | 'manual'>('timer')
  const sw = useStopwatch()
  const timerRunning = sw.running

  /**
   * Who the time is FOR, which is not always who is typing. Two people in the
   * same meeting is two entries, so the retainer draws for both.
   *
   * Null means "nobody has chosen", which resolves to the signed-in user — that
   * way the default arrives with the profile instead of needing an effect to
   * catch up with it.
   */
  const [who, setWho] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<EntryRow | null>(null)

  // The report defaults to the month in progress — the shape the CMC checkpoint
  // review asks for, and what anybody means by "this month".
  const [from, setFrom] = useState(monthStartLocal)
  const [to, setTo] = useState(todayLocal)
  const [reportBusy, setReportBusy] = useState(false)

  const { data: engagements = [] } = useQuery<EngagementRow[]>({
    queryKey: ['engagements', 'loggable'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('engagements')
        .select('id, name, nature, billing_model, contract_value, contract_rate, standard_rate, committed_hours, hours_per_period, max_hours_per_period, started_on, ended_on, organizations(name, logo_url)')
        .neq('delivery_status', 'complete')
        .order('created_at', { ascending: false })
      if (e) throw e
      return (data ?? []) as unknown as EngagementRow[]
    },
  })

  const { data: team = [] } = useQuery<ProfileRow[]>({
    queryKey: ['profiles', 'team'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('profiles').select('id, full_name')
        .in('role', ['admin', 'manager', 'member']).order('full_name')
      if (e) throw e
      return (data ?? []) as ProfileRow[]
    },
  })
  const nameById = new Map(team.map(m => [m.id, m.full_name]))

  const whoIds = who ?? (profile ? [profile.id] : [])
  const toggleWho = (id: string) => {
    const next = whoIds.includes(id) ? whoIds.filter(x => x !== id) : [...whoIds, id]
    // An entry belongs to somebody. Refusing the last removal beats logging
    // hours attributed to no one.
    if (next.length) setWho(next)
  }

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

  // What was typed, and what it bills at. Showing both makes the round-up
  // visible at the moment of entry rather than a surprise on the invoice.
  const rawMinutes = parseDuration(duration)
  const typedMinutes = parseBillable(duration)
  const roundedUp = rawMinutes != null && typedMinutes != null && typedMinutes !== rawMinutes

  // The duration comes from whichever half of the card is showing. In timer
  // mode that is the live clock, so Log is ready the moment it is, and reads
  // the same figure the clock is displaying.
  const minutes = mode === 'timer' ? (sw.billableMinutes || null) : typedMinutes
  const described = description.trim().length > 0
  const isRetainer = selected?.billing_model === 'retainer'
  const status = selected && isRetainer
    ? retainerStatus(selected, ledger, periods, entries, today)
    : null

  const log = useMutation({
    mutationFn: async ({ minutes: m }: { minutes: number; fromTimer: boolean }) => {
      if (!m || !activeId || !described || !whoIds.length) return
      const { error: e } = await supabase.from('time_entries').insert(
        whoIds.map(id => ({
          engagement_id: activeId,
          user_id: id,
          entry_date: entryDate,
          minutes: m,
          description: description.trim(),
          billable,
        })),
      )
      if (e) throw e
    },
    // The clock is only cleared once the row is in. A failed insert leaves it
    // paused with the time intact, which is the difference between a retry and
    // an afternoon reconstructed from memory.
    onSuccess: (_, vars) => {
      if (vars.fromTimer) sw.reset()
      // Back to just you. A stale second name would quietly bill somebody
      // else's hours to the next thing logged.
      setWho(null)
      setDuration(''); setDescription(''); setError(null)
      queryClient.invalidateQueries({ queryKey: ['time_entries', activeId] })
      queryClient.invalidateQueries({ queryKey: ['retainer_ledger', activeId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  /**
   * Stop the clock and log in one act. Pausing first freezes the figure at what
   * the button said, rather than billing whatever the seconds reached while the
   * insert was in flight.
   */
  const logNow = () => {
    setError(null)
    const fromTimer = mode === 'timer'
    const m = fromTimer ? sw.billableMinutes : typedMinutes
    if (!m || !described) return
    if (fromTimer) sw.pause()
    log.mutate({ minutes: m, fromTimer })
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.from('time_entries').delete().eq('id', id)
      if (e) throw e
    },
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['time_entries', activeId] })
      queryClient.invalidateQueries({ queryKey: ['retainer_ledger', activeId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  // Both bounds are optional: blank means open-ended, and the document is
  // stamped with the range the entries actually cover rather than a blank.
  const inRange = entries.filter(e => (!from || e.entry_date >= from) && (!to || e.entry_date <= to))
  const rangeMinutes = inRange.filter(e => !e.is_estimate).reduce((s, e) => s + e.minutes, 0)

  const downloadReport = async () => {
    if (!selected) return
    setReportBusy(true)
    try {
      const { downloadTimeReportPdf } = await import('../../lib/timeReportPdf')
      const dates = inRange.map(e => e.entry_date).sort()
      await downloadTimeReportPdf({
        organizationName: selected.organizations?.name ?? '',
        engagementName: selected.name,
        from: from || dates[0] || todayLocal(),
        to: to || dates[dates.length - 1] || todayLocal(),
        entries: inRange.map(e => ({
          entry_date: e.entry_date,
          minutes: e.minutes,
          description: e.description,
          billable: e.billable,
          is_estimate: e.is_estimate,
          who: e.user_id ? firstName(nameById.get(e.user_id) ?? 'Unattributed') : 'Unattributed',
        })),
        retainerBalance: status?.balance ?? null,
        committedHours: status?.committed ?? null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the report')
    } finally {
      setReportBusy(false)
    }
  }

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20'
  const todayKey = todayLocal()
  const todayMinutes = entries.filter(e => e.entry_date === todayKey).reduce((s, e) => s + e.minutes, 0)
  // Monday-anchored, matching how a week of work is actually talked about.
  const monday = new Date(today)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const mondayKey = todayLocal(monday)
  const weekMinutes = entries.filter(e => e.entry_date >= mondayKey && e.entry_date <= todayKey)
    .reduce((s, e) => s + e.minutes, 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Time</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            {selected?.organizations?.name ?? 'No engagements yet'}
          </p>
        </div>
        <div className="flex gap-8">
          <div>
            <p className="text-3xl font-bold text-navy tabular-nums leading-none">
              {formatHours(todayMinutes)}
            </p>
            <p className="text-xs text-gray-600 mt-1">hours today</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-navy/40 tabular-nums leading-none">
              {formatHours(weekMinutes)}
            </p>
            <p className="text-xs text-gray-600 mt-1">this week</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        <div className="space-y-6">
          {/* Two ways in, chosen explicitly. The engagement and the
              description are shared — only how the duration arrives differs, so
              the toggle swaps the middle of one card rather than two forms. */}
          <div>
            <div className="rounded-t-2xl bg-gradient-to-br from-navy via-navy-800 to-navy-900 text-white p-6 sm:p-7">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {selected?.organizations?.logo_url
                    ? <img src={selected.organizations.logo_url} alt="" className="w-full h-full object-contain p-1.5" />
                    : <span className="text-sm font-bold text-white/80">{initials(selected?.organizations?.name ?? '')}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <select
                    value={activeId}
                    onChange={e => setEngagementId(e.target.value)}
                    disabled={timerRunning}
                    className="max-w-full bg-transparent text-white font-semibold text-[0.95rem] -ml-1 px-1 py-0.5 rounded outline-none focus:bg-white/10 hover:bg-white/10 disabled:cursor-not-allowed cursor-pointer truncate"
                  >
                    {engagements.map(e => (
                      <option key={e.id} value={e.id} className="text-navy">
                        {e.organizations?.name} · {e.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-white/70 mt-0.5 px-0.5">
                    {timerRunning ? 'Locked while the timer runs' : 'What are you working on?'}
                  </p>
                </div>
                {timerRunning && (
                  <span className="flex items-center gap-2 text-xs font-medium text-white shrink-0">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-river opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-river" />
                    </span>
                    Running
                  </span>
                )}
              </div>

              <div className="mt-6 inline-flex rounded-xl bg-white/10 p-1">
                {(['timer', 'manual'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    // Switching away mid-run would hide a clock that is still
                    // counting, which is how time gets lost.
                    disabled={timerRunning && m === 'manual'}
                    className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      mode === m ? 'bg-white text-navy' : 'text-white/80 hover:text-white'
                    }`}
                  >
                    {m === 'timer' ? 'Stopwatch' : 'Enter manually'}
                  </button>
                ))}
              </div>

              <div className="mt-5">
                {mode === 'timer' ? (
                  <Stopwatch sw={sw} />
                ) : (
                  <div className="grid sm:grid-cols-[150px_1fr] gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-white/70 mb-1.5">Date</label>
                      <input
                        type="date"
                        value={entryDate}
                        onChange={e => setEntryDate(e.target.value)}
                        className="w-full text-sm bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white outline-none focus:border-white/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wide text-white/70 mb-1.5">
                        How long? <span className="font-normal normal-case">— 2.5, 90m, or 1:30</span>
                      </label>
                      <div className="flex gap-2">
                        <input
                          value={duration}
                          onChange={e => setDuration(e.target.value)}
                          placeholder="2.5"
                          className="w-full text-sm bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder:text-white/65 outline-none focus:border-white/50"
                        />
                        <div className="flex gap-1 shrink-0">
                          {QUICK.map(m => (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setDuration(formatHours(m))}
                              className="text-xs px-2 py-1 rounded border border-white/20 text-white/80 hover:border-white/50 hover:text-white transition-colors"
                            >
                              {formatHours(m)}
                            </button>
                          ))}
                        </div>
                      </div>
                      {duration && typedMinutes == null && (
                        <p className="text-xs text-red-300 mt-1">Not a duration I can read.</p>
                      )}
                      {roundedUp && (
                        <p className="text-xs text-white/70 mt-1">
                          {rawMinutes} min bills as <span className="font-medium text-white">{formatHours(typedMinutes!)} h</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-b-2xl border border-t-0 border-gray-200 p-6 sm:p-7 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  What did you do?
                </label>
                <input
                  className={inputCls}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Extract and assess the current marketing cloud data"
                  onKeyDown={e => { if (e.key === 'Enter') logNow() }}
                />
              </div>
              {/* Who the hours belong to. Both chips lit means both of you were
                  there, and logs the duration once for each. */}
              {team.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide mr-1">Who</span>
                  {team.map(m => {
                    const on = whoIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleWho(m.id)}
                        aria-pressed={on}
                        className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                          on
                            ? 'bg-navy border-navy text-white'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-navy hover:text-navy'
                        }`}
                      >
                        {firstName(m.full_name)}
                      </button>
                    )
                  })}
                  {whoIds.length > 1 && (
                    <span className="text-xs text-gray-500">
                      logs {formatHours(minutes ?? 0)} h each
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="rounded" />
                  Billable
                </label>
                <button
                  onClick={logNow}
                  disabled={!minutes || !described || log.isPending}
                  className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
                >
                  {log.isPending
                    ? 'Logging…'
                    : minutes
                      ? `${timerRunning ? 'Stop and log' : 'Log'} ${formatHours(minutes)} h${whoIds.length > 1 ? ` × ${whoIds.length}` : ''}`
                      : 'Log time'}
                </button>
              </div>
              {/* The button is disabled, so say why rather than leaving it dead. */}
              {!!minutes && !described && (
                <p className="text-xs text-gray-500">Say what you did to log it.</p>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-navy">Recent entries</h2>
              {entries.length > 0 && (
                <span className="text-xs text-gray-600 tabular-nums">
                  {formatHours(entries.reduce((s, e) => s + e.minutes, 0))} h total
                </span>
              )}
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
                    <span className="text-sm font-semibold text-navy tabular-nums w-14 shrink-0 text-right">
                      {formatHours(e.minutes)} h
                    </span>
                    <span className="text-sm text-gray-600 flex-1 min-w-0 truncate">
                      {e.description || <span className="text-gray-400">—</span>}
                    </span>
                    {e.user_id && nameById.has(e.user_id) && (
                      <span className="text-xs text-gray-500 shrink-0">
                        {firstName(nameById.get(e.user_id)!)}
                      </span>
                    )}
                    {e.is_estimate && (
                      <span className="text-[0.7rem] uppercase tracking-wide text-earth shrink-0">estimated</span>
                    )}
                    {!e.billable && (
                      <span className="text-[0.7rem] uppercase tracking-wide text-gray-500 shrink-0">non-billable</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(e)}
                        className="text-gray-400 hover:text-navy transition-colors p-0.5"
                        aria-label="Edit entry"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => remove.mutate(e.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-0.5"
                        aria-label="Delete entry"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-semibold text-navy">Time report</h2>
              <div className="flex gap-1">
                {([
                  ['This month', () => { setFrom(monthStartLocal()); setTo(todayLocal()) }],
                  ['Last month', () => { setFrom(monthStartLocal(-1)); setTo(monthEndLocal(-1)) }],
                  ['All time', () => { setFrom(''); setTo('') }],
                ] as const).map(([label, apply]) => (
                  <button
                    key={label}
                    onClick={apply}
                    className="text-xs px-2.5 py-1 rounded border border-gray-200 text-gray-600 hover:border-navy hover:text-navy transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">From</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">To</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
              </div>
              <button
                onClick={downloadReport}
                disabled={reportBusy}
                className="flex items-center gap-2 text-sm font-medium border border-gray-300 text-navy hover:border-navy px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
              >
                <FileDown size={14} /> {reportBusy ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-600">
              {inRange.length === 0
                ? 'Nothing logged in this range.'
                : `${formatHours(rangeMinutes)} h across ${inRange.length} ${inRange.length === 1 ? 'entry' : 'entries'}`}
            </p>
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
            <h2 className="text-sm font-semibold text-navy mb-1">
              {selected.billing_model === 'non_billable' ? 'Contributed work' : 'Billed in arrears'}
            </h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              {selected.billing_model === 'non_billable'
                ? 'Hours are logged so the value is measured rather than estimated — they are never invoiced.'
                : 'Hours accrue and are invoiced after the work, not against a prepaid balance.'}
            </p>
            {billingLabel(selected.nature, selected.billing_model, selected.contract_rate, selected.contract_value).includes('not set') && (
              <p className="mt-3 text-xs text-earth leading-relaxed">
                No rate recorded yet. Hours will log fine, but they cannot be turned into an invoice
                until one is set.
              </p>
            )}
            <p className="mt-4 text-sm text-navy font-semibold tabular-nums">
              {formatHours(entries.reduce((s, e) => s + e.minutes, 0))} h logged
            </p>
          </div>
        )}
      </div>

      {editing && (
        <EntryEditDialog entry={editing} team={team} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
