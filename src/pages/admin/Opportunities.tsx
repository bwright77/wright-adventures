import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, LayoutList, Columns3 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { Opportunity, OpportunityTypeId } from '../../lib/types'

type TabFilter = 'all' | OpportunityTypeId
type ViewMode  = 'table' | 'kanban'

// ── Pipeline definitions ──────────────────────────────────────
const GRANT_COLS = [
  { id: 'grant_identified',   label: 'Identified'   },
  { id: 'grant_evaluating',   label: 'Evaluating'   },
  { id: 'grant_preparing',    label: 'Preparing'    },
  { id: 'grant_submitted',    label: 'Submitted'    },
  { id: 'grant_under_review', label: 'Under Review' },
  { id: 'grant_awarded',      label: 'Awarded'      },
  { id: 'grant_declined',     label: 'Declined'     },
]
const PARTNERSHIP_COLS = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_outreach',    label: 'Outreach'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
  { id: 'partnership_formalizing', label: 'Formalizing' },
  { id: 'partnership_active',      label: 'Active'      },
  { id: 'partnership_on_hold',     label: 'On Hold'     },
  { id: 'partnership_completed',   label: 'Completed'   },
]

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  [...GRANT_COLS, ...PARTNERSHIP_COLS].map(s => [s.id, s.label])
)

const STATUS_COLORS: Record<string, string> = {
  grant_awarded:          'bg-trail-50 text-trail',
  grant_submitted:        'bg-river-50 text-river',
  grant_declined:         'bg-red-50 text-red-600',
  grant_withdrawn:        'bg-gray-100 text-gray-500',
  partnership_active:     'bg-trail-50 text-trail',
  partnership_completed:  'bg-gray-100 text-gray-500',
  partnership_declined:   'bg-red-50 text-red-600',
}

// ── Kanban card ───────────────────────────────────────────────
function KanbanCard({ opp }: { opp: Opportunity }) {
  const org = opp.funder ?? opp.partner_org

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
          {format(new Date(opp.primary_deadline), 'MMM d')}
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
  const queryClient = useQueryClient()
  const [tab, setTab]       = useState<TabFilter>('all')
  const [search, setSearch] = useState('')
  const [view, setView]     = useState<ViewMode>('table')

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
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

  const filtered = opportunities.filter(o => {
    if (tab !== 'all' && o.type_id !== tab) return false
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Kanban only shows one type at a time; default to grant if 'all'
  const kanbanType: OpportunityTypeId = tab === 'all' ? 'grant' : tab
  const kanbanCols = kanbanType === 'grant' ? GRANT_COLS : PARTNERSHIP_COLS
  const kanbanOpps = opportunities.filter(o =>
    o.type_id === kanbanType &&
    (!search || o.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">{opportunities.length} total</p>
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
          {(['all', 'grant', 'partnership'] as TabFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
              }`}
            >
              {t === 'all' ? 'All' : t === 'grant' ? 'Grants' : 'Partnerships'}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search opportunities…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors"
          />
        </div>

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
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : view === 'kanban' ? (
        // ── Kanban ───────────────────────────────────────────────
        <div>
          {tab === 'all' && (
            <p className="text-xs text-gray-400 mb-3">
              Showing {kanbanType} pipeline — select Grants or Partnerships to switch.
            </p>
          )}
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
        // ── Empty state ──────────────────────────────────────────
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
        // ── Table ────────────────────────────────────────────────
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden sm:table-cell">Type</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Status</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden md:table-cell">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link
                      to={`/admin/opportunities/${o.id}`}
                      className="text-sm font-medium text-navy hover:text-river transition-colors"
                    >
                      {o.name}
                    </Link>
                    {(o.funder ?? o.partner_org) && (
                      <p className="text-xs text-gray-400 mt-0.5">{o.funder ?? o.partner_org}</p>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden sm:table-cell">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded capitalize ${
                      o.type_id === 'grant' ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
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
                    {o.primary_deadline ? format(new Date(o.primary_deadline), 'MMM d, yyyy') : '—'}
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
