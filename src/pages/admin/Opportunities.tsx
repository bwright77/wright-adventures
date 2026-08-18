import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, LayoutList, Columns3, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { parseLocalDate } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Opportunity, OpportunityTypeId, DealConfidence } from '../../lib/types'

type OpportunityWithLogo = Opportunity & {
  partnership_details?: {
    logo_url: string | null
    confidence: DealConfidence | null
    next_action_date: string | null
  } | null
}

type TabFilter = 'all' | OpportunityTypeId
type ViewMode  = 'table' | 'kanban'

// ── Pipeline definitions ──────────────────────────────────────
const PARTNERSHIP_COLS = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_qualifying',  label: 'Qualifying'  },
  { id: 'partnership_discovery',   label: 'Discovery'   },
  { id: 'partnership_proposal',    label: 'Proposal'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
]

// Terminal statuses excluded from "active" pseudo-filter
const INACTIVE_PARTNERSHIP_STATUSES  = ['partnership_closed_won', 'partnership_closed_lost']

// Full status lists (including terminal) for the filter dropdown
const PARTNERSHIP_STATUSES = [
  ...PARTNERSHIP_COLS,
  { id: 'partnership_closed_won',  label: 'Closed-Won'  },
  { id: 'partnership_closed_lost', label: 'Closed-Lost' },
]

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  PARTNERSHIP_STATUSES.map(s => [s.id, s.label])
)

const STATUS_COLORS: Record<string, string> = {
  partnership_closed_won:  'bg-trail-50 text-trail',
  partnership_closed_lost: 'bg-red-50 text-red-600',
}

// ── Score detail drawer ───────────────────────────────────────

// ── Kanban card ───────────────────────────────────────────────
function KanbanCard({ opp }: { opp: Opportunity }) {
  const org = opp.partner_org

  return (
    <Link
      to={`/admin/opportunities/${opp.id}`}
      draggable
      onDragStart={e => e.dataTransfer.setData('opportunityId', opp.id)}
      className="block bg-white rounded-lg border border-gray-200 p-3 hover:border-river/30 hover:shadow-sm transition-all cursor-pointer"
    >
      <p className="text-sm font-medium text-navy leading-snug">{opp.name}</p>
      {org && <p className="text-xs text-gray-400 mt-0.5 truncate">{org}</p>}
      {opp.primary_deadline && (
        <p className="text-xs text-gray-400 mt-2">
          {format(parseLocalDate(opp.primary_deadline), 'MMM d')}
        </p>
      )}
    </Link>
  )
}

// ── Kanban column ─────────────────────────────────────────────
function KanbanCol({
  col,
  opportunities,
  onDrop,
}: {
  col:           { id: string; label: string }
  opportunities: Opportunity[]
  onDrop:        (id: string, status: string) => void
}) {
  const [over, setOver] = useState(false)

  return (
    <div
      className={`flex flex-col min-w-[220px] w-[220px] ${over ? 'opacity-80' : ''}`}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault()
        setOver(false)
        const oppId = e.dataTransfer.getData('opportunityId')
        if (oppId) onDrop(oppId, col.id)
      }}
    >
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-[0.07em]">{col.label}</span>
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
          {opportunities.length}
        </span>
      </div>
      <div
        className={`flex-1 space-y-2 min-h-[120px] rounded-lg p-2 transition-colors ${
          over ? 'bg-river/5 border-2 border-river/20 border-dashed' : 'bg-gray-50'
        }`}
      >
        {opportunities.map(o => (
          <KanbanCard key={o.id} opp={o} />
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function Opportunities() {
  const queryClient  = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab          = (searchParams.get('tab')    ?? 'all') as TabFilter
  const statusFilter =  searchParams.get('status') ?? ''

  function setTab(t: TabFilter) {
    // Switching tabs clears status filter
    setSearchParams(t === 'all' ? {} : { tab: t }, { replace: true })
  }
  function setStatus(s: string) {
    const params: Record<string, string> = {}
    if (tab !== 'all') params.tab = tab
    if (s) params.status = s
    setSearchParams(params, { replace: true })
  }

  const statusOptions = PARTNERSHIP_STATUSES
  const [search, setSearch] = useState('')
  const [view, setView]     = useState<ViewMode>('table')

  type SortKey = 'name' | 'type_id' | 'status' | 'primary_deadline'
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const { data: opportunities = [], isLoading } = useQuery<OpportunityWithLogo[]>({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, partnership_details(logo_url, confidence, next_action_date, engagement_nature, list_value)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OpportunityWithLogo[]
    },
  })

  const moveCard = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const opp = opportunities.find(o => o.id === id)
      if (!opp || opp.status === status) return
      const { error } = await supabase
        .from('opportunities')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      await supabase.from('activity_log').insert({
        opportunity_id: id,
        actor_id:       null,
        action:         'status_changed',
        details:        { from: opp.status, to: status },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
  })

  const pipelineOpps = opportunities

  const filtered = pipelineOpps.filter(o => {
    if (tab !== 'all' && o.type_id !== tab) return false
    if (statusFilter === 'active') {
      if (INACTIVE_PARTNERSHIP_STATUSES.includes(o.status)) return false
    } else if (statusFilter) {
      if (o.status !== statusFilter) return false
    }
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1
        if (sortKey === 'primary_deadline') {
          const aT = a.primary_deadline ? new Date(a.primary_deadline).getTime() : Infinity
          const bT = b.primary_deadline ? new Date(b.primary_deadline).getTime() : Infinity
          return (aT - bT) * dir
        }
        const aV = (a[sortKey] ?? '').toString().toLowerCase()
        const bV = (b[sortKey] ?? '').toString().toLowerCase()
        return aV.localeCompare(bV) * dir
      })
    : filtered

  const kanbanCols = PARTNERSHIP_COLS
  const kanbanOpps = pipelineOpps.filter(o =>
    (!search || o.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">{pipelineOpps.length} in pipeline</p>
        </div>
        <Link
          to="/admin/opportunities/new"
          className="flex items-center gap-2 bg-river hover:bg-river/90 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Opportunity
        </Link>
      </div>

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all', 'partnership'] as TabFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
              }`}
            >
              {t === 'all' ? 'All' : 'Partnerships'}
            </button>
          ))}
        </div>

        {(
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search opportunities…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors"
            />
          </div>
        )}

        {view === 'table' && (
          <select
            value={statusFilter}
            onChange={e => setStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 text-gray-600"
          >
            <option value="">All statuses</option>
            <option value="active">Active only</option>
            {statusOptions.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        )}

        {(
          <div className="ml-auto flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button
              onClick={() => setView('table')}
              className={`p-1.5 rounded transition-colors ${view === 'table' ? 'bg-white shadow-sm text-navy' : 'text-gray-400 hover:text-navy'}`}
              title="Table view"
            >
              <LayoutList size={15} />
            </button>
            <button
              onClick={() => setView('kanban')}
              className={`p-1.5 rounded transition-colors ${view === 'kanban' ? 'bg-white shadow-sm text-navy' : 'text-gray-400 hover:text-navy'}`}
              title="Kanban view"
            >
              <Columns3 size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
            ) : view === 'kanban' ? (
        <div>
          <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
            {kanbanCols.map(col => (
              <KanbanCol
                key={col.id}
                col={col}
                opportunities={kanbanOpps.filter(o => o.status === col.id)}
                onDrop={(oppId, status) => moveCard.mutate({ id: oppId, status })}
              />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-xl border border-gray-200">
          <p className="text-gray-400 text-sm mb-2">
            {search ? 'No results match your search.' : 'No opportunities yet.'}
          </p>
          {!search && (
            <Link to="/admin/opportunities/new" className="text-sm text-river hover:underline">
              Create your first opportunity →
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {(
                  [
                    { key: 'name',              label: 'Name',     className: 'px-5 py-3.5' },
                    { key: 'type_id',           label: 'Type',     className: 'px-5 py-3.5 hidden sm:table-cell' },
                    { key: 'status',            label: 'Status',   className: 'px-5 py-3.5' },
                    { key: 'primary_deadline',  label: 'Deadline', className: 'px-5 py-3.5 hidden md:table-cell' },
                  ] as { key: SortKey; label: string; className: string }[]
                ).map(({ key, label, className }) => {
                  const active = sortKey === key
                  return (
                    <th key={key} className={`text-left text-xs font-medium uppercase tracking-[0.07em] ${className}`}>
                      <button
                        onClick={() => toggleSort(key)}
                        className={`flex items-center gap-1 group ${active ? 'text-navy' : 'text-gray-400 hover:text-gray-600'}`}
                      >
                        {label}
                        <span className={active ? 'text-navy' : 'text-gray-300 group-hover:text-gray-400'}>
                          {active && sortDir === 'desc'
                            ? <ChevronDown size={12} />
                            : <ChevronUp size={12} />
                          }
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      {o.type_id === 'partnership' && (() => {
                        const logo = o.partnership_details?.logo_url
                        const initials = (o.partner_org ?? o.name).charAt(0).toUpperCase()
                        return logo ? (
                          <img
                            src={logo}
                            alt=""
                            className="w-7 h-7 rounded object-contain bg-gray-50 border border-gray-100 shrink-0"
                            onError={(ev) => {
                              const img = ev.target as HTMLImageElement
                              img.style.display = 'none'
                              if (img.nextElementSibling) (img.nextElementSibling as HTMLElement).style.display = 'flex'
                            }}
                          />
                        ) : (
                          <div className="w-7 h-7 rounded bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-[11px] font-semibold text-gray-400">
                            {initials}
                          </div>
                        )
                      })()}
                      <div>
                        <Link
                          to={`/admin/opportunities/${o.id}`}
                          className="text-sm font-medium text-navy hover:text-river transition-colors"
                        >
                          {o.name}
                        </Link>
                        {o.partner_org && (
                          <p className="text-xs text-gray-400 mt-0.5">{o.partner_org}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4 hidden sm:table-cell">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded capitalize ${
                      'bg-trail-50 text-trail'
                    }`}>
                      {o.type_id}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                      STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'
                    }`}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500 hidden md:table-cell">
                    {o.primary_deadline ? format(parseLocalDate(o.primary_deadline), 'MMM d, yyyy') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
