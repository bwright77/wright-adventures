import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search, LayoutList, Columns3, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { parseLocalDate } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import type { Opportunity, DealConfidence } from '../../lib/types'
import { SERVICE_LINE_LABELS } from '../../lib/serviceLines'
import { usePipelineStatuses, STATUS_COLORS } from '../../lib/usePipelineStatuses'
import { computeStageAge } from '../../lib/stageAge'
import type { StageAge } from '../../lib/stageAge'
import { StageAgeBadge } from '../../components/admin/StageAgeBadge'

type OpportunityWithLogo = Opportunity & {
  partnership_details?: {
    logo_url: string | null
    revisit_on?: string | null
    confidence: DealConfidence | null
    next_action_date: string | null
    stage_entered_at?: string | null
    decision_date?: string | null
    decision_body?: string | null
  } | null
}

// The three states that matter operationally: work we are doing, work we are
// chasing, and work we lost. Replaced 'all | partnership | lead', which split by
// record type rather than by anything anyone acts on.
type TabFilter = 'pursuing' | 'nurturing' | 'active' | 'lost'

// Every stage must appear in exactly one tab. A stage missing from all of them
// is invisible — which is what happened when Evaluation and Nurture were added
// to pipeline_statuses without being added here.
const TAB_STATUSES: Record<TabFilter, readonly string[]> = {
  pursuing: [
    'partnership_qualifying', 'partnership_discovery', 'partnership_proposal',
    'partnership_evaluation', 'partnership_approval', 'partnership_negotiating',
  ],
  nurturing: ['partnership_nurture'],
  active:    ['partnership_closed_won'],
  lost:      ['partnership_closed_lost'],
}

const TAB_LABELS: Record<TabFilter, string> = {
  pursuing:  'Pursuing',
  nurturing: 'Nurturing',
  active:    'Active',
  lost:      'Closed-Lost',
}
type ViewMode  = 'table' | 'kanban'

// ── Pipeline definitions ──────────────────────────────────────
// Leads never appear here. Pursuing one converts it into a partnership at the
// discovery stage (see src/lib/leads.ts), so anything still carrying
// type_id='lead' is either awaiting triage or declined — neither is an
// opportunity.
function isOpportunity(o: { type_id: string }): boolean {
  return o.type_id !== 'lead'
}


// ── Score detail drawer ───────────────────────────────────────

// ── Kanban card ───────────────────────────────────────────────
/**
 * Logo with an initials fallback.
 *
 * Replaces an inline onError that did `img.nextElementSibling.style.display =
 * 'flex'` — but the next sibling is the name block, not a fallback, so a broken
 * logo hid the image AND forced display:flex onto the organization name. It
 * never fired while logo_url was mostly null; populating every row made it
 * reachable.
 */
function OrgAvatar({ logo, name }: { logo: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  const box = 'w-7 h-7 rounded shrink-0'

  if (!logo || failed) {
    return (
      <div className={`${box} bg-gray-100 border border-gray-200 flex items-center justify-center text-[11px] font-semibold text-gray-400`}>
        {name.charAt(0).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={logo}
      alt=""
      onError={() => setFailed(true)}
      className={`${box} object-contain bg-gray-50 border border-gray-100`}
    />
  )
}

function KanbanCard({ opp, age }: { opp: OpportunityWithLogo; age: StageAge | null }) {
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
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <StageAgeBadge age={age} />
        {opp.primary_deadline && (
          <span className="text-xs text-gray-400">
            {format(parseLocalDate(opp.primary_deadline), 'MMM d')}
          </span>
        )}
      </div>
    </Link>
  )
}

// ── Kanban column ─────────────────────────────────────────────
function KanbanCol({
  col,
  opportunities,
  onDrop,
  ageOf,
}: {
  col:           { id: string; label: string }
  opportunities: OpportunityWithLogo[]
  onDrop:        (id: string, status: string) => void
  ageOf:         (o: OpportunityWithLogo) => StageAge | null
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
          <KanbanCard key={o.id} opp={o} age={ageOf(o)} />
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function Opportunities() {
  const queryClient  = useQueryClient()
  const { labels: STATUS_LABELS, columnsFor, all: allStages } = usePipelineStatuses('partnership')
  const [searchParams, setSearchParams] = useSearchParams()
  // Validate rather than assert. `as TabFilter` on a URL param is a lie: any
  // stale link — ?tab=partnership from before the tabs were reworked — indexes
  // TAB_STATUSES with a missing key and throws on .includes().
  const rawTab       = searchParams.get('tab')
  const tab: TabFilter = rawTab !== null && Object.prototype.hasOwnProperty.call(TAB_STATUSES, rawTab)
    ? rawTab as TabFilter
    : 'pursuing'
  // Same defence for status: a stale ?status=active is not a status id, and
  // would silently filter the list to nothing rather than crashing.
  const rawStatus    = searchParams.get('status') ?? ''
  const statusFilter = TAB_STATUSES[tab].includes(rawStatus) ? rawStatus : ''

  function setTab(t: TabFilter) {
    // Switching tabs clears status filter
    setSearchParams(t === 'pursuing' ? {} : { tab: t }, { replace: true })
  }
  function setStatus(s: string) {
    const params: Record<string, string> = {}
    if (tab !== 'pursuing') params.tab = tab
    if (s) params.status = s
    setSearchParams(params, { replace: true })
  }

  // Filter offers exactly the stages this tab contains — no more drift.
  const statusOptions = columnsFor(TAB_STATUSES[tab])
  const [search, setSearch] = useState('')
  const [view, setView]     = useState<ViewMode>('table')

  type SortKey = 'name' | 'status' | 'primary_deadline'
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
              // The !opportunity_id hint is required, not decorative. partnership_details
      // has TWO foreign keys to opportunities — opportunity_id (its primary key)
      // and previous_opportunity_id (set when a lost deal is reopened as a new
      // record). PostgREST cannot infer which one an embed means and fails the
      // whole query with PGRST201, which silently empties the list.
      .select('*, partnership_details!opportunity_id(logo_url, confidence, next_action_date, engagement_nature, list_value, revisit_on, stage_entered_at, decision_date, decision_body)')
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

  const pipelineOpps = opportunities.filter(isOpportunity)

  const filtered = pipelineOpps.filter(o => {
    if (!TAB_STATUSES[tab].includes(o.status)) return false
    if (statusFilter && o.status !== statusFilter) return false
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const tabCounts = Object.fromEntries(
    (Object.keys(TAB_STATUSES) as TabFilter[]).map(t =>
      [t, pipelineOpps.filter(o => TAB_STATUSES[t].includes(o.status)).length],
    ),
  ) as Record<TabFilter, number>

  // Nurture is worked off the revisit date — soonest first, undated last.
  const defaultSorted = tab === 'nurturing'
    ? [...filtered].sort((a, b) => {
        const aT = a.partnership_details?.revisit_on ? new Date(a.partnership_details.revisit_on).getTime() : Infinity
        const bT = b.partnership_details?.revisit_on ? new Date(b.partnership_details.revisit_on).getTime() : Infinity
        return aT - bT
      })
    : filtered

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
    : defaultSorted

  // One `today` for the whole render, so every badge on screen agrees, and one
  // stage lookup rather than a find() per row.
  const today = new Date()
  const stageById = new Map(allStages.map(st => [st.id, st]))
  const ageOf = (o: OpportunityWithLogo): StageAge | null =>
    computeStageAge({
      status:         o.status,
      stageEnteredAt: o.partnership_details?.stage_entered_at ?? null,
      decisionDate:   o.partnership_details?.decision_date ?? null,
      decisionBody:   o.partnership_details?.decision_body ?? null,
      revisitOn:      o.partnership_details?.revisit_on ?? null,
      stage:          stageById.get(o.status),
      today,
    })

  const kanbanCols = columnsFor(TAB_STATUSES.pursuing)
  const kanbanOpps = pipelineOpps.filter(o =>
    TAB_STATUSES.pursuing.includes(o.status) &&
    (!search || o.name.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {tab === 'active'   && `${filtered.length} engagement${filtered.length === 1 ? '' : 's'} in flight`}
            {tab === 'pursuing'  && `${filtered.length} in the pipeline`}
            {tab === 'nurturing' && `${filtered.length} warm, no active opportunity`}
            {tab === 'lost'     && `${filtered.length} not won`}
          </p>
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
          {(Object.keys(TAB_STATUSES) as TabFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
              }`}
            >
              {TAB_LABELS[t]}
              <span className={`text-[0.7rem] tabular-nums ${tab === t ? 'text-gray-400' : 'text-gray-300'}`}>
                {tabCounts[t]}
              </span>
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
                ageOf={ageOf}
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
                    { key: null,                label: 'Services', className: 'px-5 py-3.5 hidden md:table-cell' },
                    { key: 'status',            label: 'Status',   className: 'px-5 py-3.5' },
                    { key: 'primary_deadline',  label: 'Deadline', className: 'px-5 py-3.5 hidden md:table-cell' },
                    // key: null = not sortable. An array of service lines has no
                    // natural order worth offering.
                  ] as { key: SortKey | null; label: string; className: string }[]
                ).map(({ key, label, className }) => {
                  const active = key !== null && sortKey === key
                  return (
                    <th key={label} className={`text-left text-xs font-medium uppercase tracking-[0.07em] ${className}`}>
                      {key === null ? (
                        <span className="text-gray-400">{label}</span>
                      ) : (
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
                      )}
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
                      <OrgAvatar logo={o.partnership_details?.logo_url ?? null} name={o.partner_org ?? o.name} />
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
                  <td className="px-5 py-4 hidden md:table-cell">
                    {o.service_lines?.length ? (
                      <span className="flex flex-wrap gap-1 max-w-[16rem]">
                        {o.service_lines.slice(0, 2).map(sl => (
                          <span key={sl} className="text-[0.7rem] px-1.5 py-0.5 rounded bg-river-50 text-river whitespace-nowrap">
                            {SERVICE_LINE_LABELS[sl] ?? sl}
                          </span>
                        ))}
                        {o.service_lines.length > 2 && (
                          <span
                            className="text-[0.7rem] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500"
                            title={o.service_lines.map(sl => SERVICE_LINE_LABELS[sl] ?? sl).join(', ')}
                          >
                            +{o.service_lines.length - 2}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                        STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'
                      }`}>
                        {STATUS_LABELS[o.status] ?? o.status}
                      </span>
                      <StageAgeBadge age={ageOf(o)} />
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
