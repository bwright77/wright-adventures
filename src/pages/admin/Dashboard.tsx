import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Users, CheckSquare, Radar, Handshake } from 'lucide-react'
import { format, isAfter, addDays } from 'date-fns'
import { parseLocalDate } from '../../lib/dates'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { retainerStatus, formatHours, billingLabel } from '../../lib/retainer'
import type { LedgerRow, PeriodRow } from '../../lib/retainer'
import { useAuth } from '../../contexts/AuthContext'
import type { Opportunity, Task } from '../../lib/types'

// The real terminal statuses. The previous list — partnership_archived,
// partnership_declined, partnership_completed — named three ids that have never
// existed in pipeline_statuses, so the "active" count excluded nothing and
// included closed work.
// Mirrors the Opportunities tabs. Nurture is deliberately not "pursuing" —
// it is a warm relationship with nothing live to work on.
const PURSUING_STATUSES = [
  'qualifying', 'discovery', 'proposal',
  'evaluation', 'approval', 'negotiating',
]

function MetricCard({ label, value, sub, icon: Icon, accent, to }: {
  label: string
  value: number | string
  sub?: string
  icon: LucideIcon
  accent: string
  to?: string
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-[0.07em]">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${accent} flex items-center justify-center`}>
          <Icon size={15} className="text-white" />
        </div>
      </div>
      <p className="text-3xl font-bold text-navy leading-none mb-1">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </>
  )
  if (to) {
    return (
      <Link to={to} className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-river/40 hover:shadow-sm transition-all">
        {inner}
      </Link>
    )
  }
  return <div className="bg-white rounded-xl border border-gray-200 p-5">{inner}</div>
}

export function Dashboard() {
  const { profile } = useAuth()

  const { data: opportunities = [] } = useQuery<Opportunity[]>({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const { data: myTasks = [] } = useQuery<Task[]>({
    queryKey: ['my-tasks', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('tasks')
        .select('*, opportunity:opportunities(id, name)')
        .eq('assignee_id', profile.id)
        .neq('status', 'complete')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  const now = new Date()

  // Leads are their own table now (ADR-012) rather than opportunities wearing a
  // type_id, so this is a count query instead of a filter over the wrong list.
  // Work in flight — engagements still being delivered, with the retainer
  // figures alongside so the dashboard says what is left, not just what exists.
  const { data: engagements = [] } = useQuery<any[]>({
    queryKey: ['engagements', 'in-flight'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engagements')
        .select('id, name, nature, billing_model, contract_value, delivery_status, committed_hours, hours_per_period, max_hours_per_period, contract_rate, started_on, ended_on, organizations(name, logo_url)')
        .neq('delivery_status', 'complete')
        .order('billing_model')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: ledger = [] } = useQuery<(LedgerRow & { engagement_id: string })[]>({
    queryKey: ['retainer_ledger', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('retainer_ledger').select('engagement_id, entry_type, hours, created_at')
      if (error) throw error
      return (data ?? []) as any
    },
  })

  const { data: periods = [] } = useQuery<(PeriodRow & { engagement_id: string })[]>({
    queryKey: ['retainer_periods', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('retainer_periods')
        .select('engagement_id, period_number, period_start, period_end, hours_granted, fee, status')
      if (error) throw error
      return (data ?? []) as any
    },
  })

  const { data: timeEntries = [] } = useQuery<any[]>({
    queryKey: ['time_entries', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('time_entries').select('engagement_id, entry_date, minutes, billable')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: leadsToReview = 0 } = useQuery<number>({
    queryKey: ['leads', 'to-review'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new')
      if (error) throw error
      return count ?? 0
    },
  })
  const pursuing = opportunities.filter(o => PURSUING_STATUSES.includes(o.status))
  const activeEngagements = opportunities.filter(o => o.status === 'closed_won')

  const overdueTasks = myTasks.filter(t => t.due_date && !isAfter(new Date(t.due_date), now))

  const upcomingDeadlines = opportunities
    .filter(o =>
      o.primary_deadline &&
      isAfter(new Date(o.primary_deadline), now) &&
      !isAfter(new Date(o.primary_deadline), addDays(now, 30))
    )
    .sort((a, b) => new Date(a.primary_deadline!).getTime() - new Date(b.primary_deadline!).getTime())
    .slice(0, 5)

  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy">
            {firstName ? `Welcome, ${firstName}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Opportunity Management Platform</p>
        </div>
        <Link
          to="/admin/opportunities/new"
          className="flex items-center gap-2 bg-river hover:bg-river/90 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Opportunity
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Leads to review"
          value={leadsToReview}
          sub={leadsToReview === 0 ? 'queue clear' : 'awaiting triage'}
          icon={Radar}
          accent="bg-river"
          to="/admin/leads"
        />
        <MetricCard
          label="Pursuing"
          value={pursuing.length}
          sub="live opportunities"
          icon={Users}
          accent="bg-navy"
          to="/admin/opportunities"
        />
        <MetricCard
          label="Active"
          value={activeEngagements.length}
          sub="won engagements"
          icon={Handshake}
          accent="bg-trail"
          to="/admin/opportunities?tab=active"
        />
        <MetricCard
          label="My Tasks"
          value={myTasks.length}
          sub={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'all on track'}
          icon={CheckSquare}
          accent={overdueTasks.length > 0 ? 'bg-red-500' : 'bg-earth'}
          to="/admin/tasks"
        />
      </div>

      {engagements.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em]">
              Work in Flight
            </h2>
            <Link to="/admin/time" className="text-xs text-river-700 hover:underline">Log time →</Link>
          </div>
          <ul className="divide-y divide-gray-100">
            {engagements.map(e => {
              const isRetainer = e.billing_model === 'retainer'
              const status = isRetainer
                ? retainerStatus(
                    e,
                    ledger.filter(l => l.engagement_id === e.id),
                    periods.filter(p => p.engagement_id === e.id),
                    timeEntries.filter(t => t.engagement_id === e.id),
                    now,
                  )
                : null
              const logged = timeEntries
                .filter(t => t.engagement_id === e.id)
                .reduce((s: number, t: any) => s + t.minutes, 0)

              return (
                <li key={e.id}>
                  <Link
                    to={`/admin/time?engagement=${e.id}`}
                    className="flex items-center gap-4 py-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-navy group-hover:text-river transition-colors truncate">
                        {e.organizations?.name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">{e.name}</p>
                    </div>

                    {status ? (
                      <div className="shrink-0 w-40">
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-sm font-semibold text-navy tabular-nums">
                            {status.balance.toFixed(1)}h
                          </span>
                          <span className="text-[0.7rem] text-gray-600">of {status.committed} left</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className={`h-full transition-all ${status.overCeiling ? 'bg-red-500' : 'bg-river'}`}
                            style={{ width: `${Math.min(100, (status.hoursUsed / (status.committed || 1)) * 100)}%` }}
                          />
                        </div>
                        <p className={`text-[0.7rem] mt-1 ${status.overCeiling ? 'text-red-600' : 'text-gray-600'}`}>
                          {status.drawnThisMonth.toFixed(1)}h this month
                          {status.monthlyCeiling ? ` / ${status.monthlyCeiling} max` : ''}
                        </p>
                      </div>
                    ) : (
                      <div className="shrink-0 w-40 text-right">
                        <span className="text-sm font-semibold text-navy tabular-nums">
                          {logged ? `${formatHours(logged)}h` : '—'}
                        </span>
                        <p className={`text-[0.7rem] mt-0.5 ${
                          billingLabel(e.nature, e.billing_model, e.contract_rate, e.contract_value).includes('not set')
                            ? 'text-earth' : 'text-gray-600'
                        }`}>
                          {billingLabel(e.nature, e.billing_model, e.contract_rate, e.contract_value)}
                        </p>
                      </div>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Deadlines */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            Upcoming Deadlines
          </h2>
          {upcomingDeadlines.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400">No deadlines in the next 30 days.</p>
              <Link to="/admin/opportunities/new" className="mt-2 inline-block text-xs text-river hover:underline">
                Add your first opportunity →
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {upcomingDeadlines.map(o => (
                <li key={o.id} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0 bg-trail" />
                    <Link
                      to={`/admin/opportunities/${o.id}`}
                      className="text-sm text-navy font-medium truncate hover:text-river transition-colors"
                    >
                      {o.name}
                    </Link>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {format(parseLocalDate(o.primary_deadline!), 'MMM d')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* My Tasks */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            My Tasks
          </h2>
          {myTasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-400">No open tasks assigned to you.</p>
            </div>
          ) : (
            <>
              <ul className="space-y-3">
                {myTasks.slice(0, 5).map(t => (
                  <li key={t.id} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      t.due_date && !isAfter(new Date(t.due_date), now) ? 'bg-red-500' : 'bg-gray-300'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-navy font-medium truncate">{t.title}</p>
                      {t.due_date && (
                        <p className="text-xs text-gray-400">{format(new Date(t.due_date), 'MMM d')}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {myTasks.length > 5 && (
                <Link to="/admin/tasks" className="mt-4 inline-block text-xs text-river hover:underline">
                  View all {myTasks.length} tasks →
                </Link>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
