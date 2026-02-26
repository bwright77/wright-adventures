import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, LayoutList, Columns3, ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Opportunity, OpportunityTypeId, ScoreDetail } from '../../lib/types'

type TabFilter = 'all' | OpportunityTypeId | 'discovered'
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
  [...GRANT_COLS, ...PARTNERSHIP_COLS, { id: 'grant_discovered', label: 'Discovered' }].map(s => [s.id, s.label])
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

// ── Score badge (ADR-002: green 7–10, amber 5–6, red 1–4) ────
function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>
  const color = score >= 7
    ? 'bg-green-100 text-green-700 ring-1 ring-green-200'
    : score >= 5
    ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-200'
    : 'bg-red-100 text-red-600 ring-1 ring-red-200'
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded ${color}`}>
      {score.toFixed(1)}
    </span>
  )
}

// ── Recommended action badge ──────────────────────────────────
function ActionBadge({ action }: { action: ScoreDetail['recommended_action'] | null }) {
  if (!action) return null
  const styles: Record<string, string> = {
    apply:       'bg-green-50 text-green-700',
    investigate: 'bg-amber-50 text-amber-700',
    skip:        'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded capitalize ${styles[action] ?? 'bg-gray-100 text-gray-500'}`}>
      {action}
    </span>
  )
}

// ── Score detail drawer ───────────────────────────────────────
const SCORE_CRITERIA: Array<{ key: keyof ScoreDetail['scores']; label: string; weight: number }> = [
  { key: 'mission_alignment',      label: 'Mission Alignment',      weight: 30 },
  { key: 'geographic_eligibility', label: 'Geographic Eligibility', weight: 20 },
  { key: 'applicant_eligibility',  label: 'Applicant Eligibility',  weight: 20 },
  { key: 'award_size_fit',         label: 'Award Size Fit',         weight: 15 },
  { key: 'population_alignment',   label: 'Population Alignment',   weight: 15 },
]

function ScoreDrawer({ opp }: { opp: Opportunity }) {
  const detail = opp.ai_score_detail
  if (!detail) {
    return (
      <div className="px-5 py-4 text-sm text-gray-400 italic">
        No score detail available. Use Re-score to generate.
      </div>
    )
  }

  return (
    <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 space-y-4">
      {/* Criteria scores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {SCORE_CRITERIA.map(({ key, label, weight }) => {
          const score = detail.scores[key] ?? 0
          const barColor = score >= 7 ? 'bg-green-400' : score >= 5 ? 'bg-amber-400' : 'bg-red-400'
          return (
            <div key={key} className="bg-white rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">{label} <span className="text-gray-300">({weight}%)</span></p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score * 10}%` }} />
                </div>
                <span className="text-xs font-semibold text-navy w-6 text-right">{score}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Rationale */}
      {detail.rationale && (
        <p className="text-sm text-gray-600 leading-relaxed">{detail.rationale}</p>
      )}

      {/* Red flags */}
      {detail.red_flags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.red_flags.map((flag, i) => (
            <span key={i} className="text-xs bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded">
              ⚠ {flag}
            </span>
          ))}
        </div>
      )}

      {/* External link */}
      {opp.external_url && (
        <a
          href={opp.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-river hover:underline"
        >
          <ExternalLink size={12} />
          View on Simpler.Grants.gov
        </a>
      )}
    </div>
  )
}

// ── Discovered table ──────────────────────────────────────────
function DiscoveredTable({
  opportunities,
  onAddToPipeline,
  onSkip,
  onRescore,
  rescoringId,
}: {
  opportunities:   Opportunity[]
  onAddToPipeline: (id: string) => void
  onSkip:          (id: string) => void
  onRescore:       (id: string) => void
  rescoringId:     string | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (opportunities.length === 0) {
    return (
      <div className="py-20 text-center bg-white rounded-xl border border-gray-200">
        <p className="text-gray-400 text-sm mb-1">No discovered opportunities pending review.</p>
        <p className="text-xs text-gray-300">The pipeline checks for new grants daily at 7 AM UTC.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Opportunity</th>
            <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden sm:table-cell">Score</th>
            <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden md:table-cell">Deadline</th>
            <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {opportunities.map(opp => {
            const isExpanded = expandedId === opp.id
            const detail = opp.ai_score_detail
            return (
              <>
                <tr key={opp.id} className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50' : ''}`}>
                  {/* Name + funder */}
                  <td className="px-5 py-4">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-navy leading-snug">{opp.name}</p>
                        {opp.funder && <p className="text-xs text-gray-400 mt-0.5">{opp.funder}</p>}
                      </div>
                      {/* Score + action on mobile */}
                      <div className="flex flex-col items-end gap-1 sm:hidden">
                        <ScoreBadge score={opp.ai_match_score} />
                        <ActionBadge action={detail?.recommended_action ?? null} />
                      </div>
                    </div>
                  </td>

                  {/* Score + action — desktop */}
                  <td className="px-5 py-4 hidden sm:table-cell">
                    <div className="flex flex-col gap-1">
                      <ScoreBadge score={opp.ai_match_score} />
                      <ActionBadge action={detail?.recommended_action ?? null} />
                    </div>
                  </td>

                  {/* Deadline */}
                  <td className="px-5 py-4 text-sm text-gray-500 hidden md:table-cell">
                    {opp.primary_deadline ? format(new Date(opp.primary_deadline), 'MMM d, yyyy') : '—'}
                  </td>

                  {/* Actions */}
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : opp.id)}
                        className="p-1.5 text-gray-400 hover:text-navy rounded-lg hover:bg-gray-100 transition-colors"
                        title={isExpanded ? 'Collapse' : 'View score detail'}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      <button
                        onClick={() => onRescore(opp.id)}
                        disabled={rescoringId === opp.id}
                        className="p-1.5 text-gray-400 hover:text-river rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-40"
                        title="Re-score with current org profile"
                      >
                        <RefreshCw size={14} className={rescoringId === opp.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => onSkip(opp.id)}
                        className="text-xs text-gray-400 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                      >
                        Skip
                      </button>
                      <button
                        onClick={() => onAddToPipeline(opp.id)}
                        className="text-xs font-medium text-white bg-river hover:bg-river/90 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Add to Pipeline
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Score drawer — expands below the row */}
                {isExpanded && (
                  <tr key={`${opp.id}-drawer`}>
                    <td colSpan={4} className="p-0">
                      <ScoreDrawer opp={opp} />
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
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
  const queryClient  = useQueryClient()
  const { session }  = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = ((searchParams.get('tab') ?? 'all') as TabFilter)
  function setTab(t: TabFilter) {
    setSearchParams(t === 'all' ? {} : { tab: t }, { replace: true })
  }
  const [search, setSearch] = useState('')
  const [view, setView]     = useState<ViewMode>('table')
  const [rescoringId, setRescoringId] = useState<string | null>(null)

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

  const promoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'grant_identified', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
  })

  const skipMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ status: 'grant_archived', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['opportunities'] }),
  })

  async function handleRescore(id: string) {
    setRescoringId(id)
    try {
      const res = await fetch('/api/discovery/score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ opportunity_id: id }),
      })
      if (!res.ok) throw new Error('Re-score failed')
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    } finally {
      setRescoringId(null)
    }
  }

  // Discovered opps: auto-discovered items in the review queue, sorted by score
  const discoveredOpps = [...opportunities]
    .filter(o => o.auto_discovered && o.status === 'grant_discovered')
    .sort((a, b) => (b.ai_match_score ?? 0) - (a.ai_match_score ?? 0))

  // Pipeline opps: exclude the discovered review queue from all other tabs
  const pipelineOpps = opportunities.filter(
    o => !(o.auto_discovered && o.status === 'grant_discovered')
  )

  const filtered = pipelineOpps.filter(o => {
    if (tab !== 'all' && o.type_id !== tab) return false
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const kanbanType: OpportunityTypeId = tab === 'all' ? 'grant' : (tab as OpportunityTypeId)
  const kanbanCols = kanbanType === 'grant' ? GRANT_COLS : PARTNERSHIP_COLS
  const kanbanOpps = pipelineOpps.filter(o =>
    o.type_id === kanbanType &&
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

          {/* Discovered tab with pending count badge */}
          <button
            onClick={() => setTab('discovered')}
            className={`relative flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === 'discovered' ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
            }`}
          >
            Discovered
            {discoveredOpps.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold bg-river text-white rounded-full px-1">
                {discoveredOpps.length}
              </span>
            )}
          </button>
        </div>

        {tab !== 'discovered' && (
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

        {tab !== 'discovered' && (
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
      ) : tab === 'discovered' ? (
        <DiscoveredTable
          opportunities={discoveredOpps}
          onAddToPipeline={id => promoteMutation.mutate(id)}
          onSkip={id => skipMutation.mutate(id)}
          onRescore={handleRescore}
          rescoringId={rescoringId}
        />
      ) : view === 'kanban' ? (
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
