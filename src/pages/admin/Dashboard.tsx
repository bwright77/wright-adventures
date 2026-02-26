import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, DollarSign, Users, CheckSquare, Briefcase } from 'lucide-react'
import { format, isAfter, addDays } from 'date-fns'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Opportunity, Task } from '../../lib/types'

const INACTIVE_GRANT_STATUSES = ['grant_archived', 'grant_declined', 'grant_withdrawn']
const INACTIVE_PARTNERSHIP_STATUSES = ['partnership_archived', 'partnership_declined', 'partnership_completed']

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
        .select('*, opportunity:opportunities(id, name, type_id)')
        .eq('assignee_id', profile.id)
        .neq('status', 'complete')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  const now = new Date()
  const activeGrants       = opportunities.filter(o => o.type_id === 'grant'       && !INACTIVE_GRANT_STATUSES.includes(o.status))
  const activePartnerships = opportunities.filter(o => o.type_id === 'partnership' && !INACTIVE_PARTNERSHIP_STATUSES.includes(o.status))
  const overdueTasks       = myTasks.filter(t => t.due_date && !isAfter(new Date(t.due_date), now))

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
          label="Active Grants"
          value={activeGrants.length}
          sub="in pipeline"
          icon={DollarSign}
          accent="bg-river"
          to="/admin/opportunities?tab=grant"
        />
        <MetricCard
          label="Partnerships"
          value={activePartnerships.length}
          sub="active"
          icon={Users}
          accent="bg-trail"
          to="/admin/opportunities?tab=partnership"
        />
        <MetricCard
          label="My Tasks"
          value={myTasks.length}
          sub={overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : 'all on track'}
          icon={CheckSquare}
          accent={overdueTasks.length > 0 ? 'bg-red-500' : 'bg-earth'}
          to="/admin/tasks"
        />
        <MetricCard
          label="Total"
          value={opportunities.length}
          sub="all opportunities"
          icon={Briefcase}
          accent="bg-navy"
          to="/admin/opportunities"
        />
      </div>

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
                    <span className={`w-2 h-2 rounded-full shrink-0 ${o.type_id === 'grant' ? 'bg-river' : 'bg-trail'}`} />
                    <Link
                      to={`/admin/opportunities/${o.id}`}
                      className="text-sm text-navy font-medium truncate hover:text-river transition-colors"
                    >
                      {o.name}
                    </Link>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">
                    {format(new Date(o.primary_deadline!), 'MMM d')}
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
