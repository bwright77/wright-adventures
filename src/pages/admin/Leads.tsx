import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ChevronDown, ChevronUp, MapPin, Calendar, AlertTriangle, CheckCircle2, Search, ArrowUpDown } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { convertLeadToOpportunity } from '../../lib/leads'
import { parseLocalDate } from '../../lib/dates'
import {
  DIMENSION_LABELS, MAX_FIT_SCORE, BAND_PURSUE_HARD, BAND_PURSUE_LEAN,
  type FitAssessment, type FitAction, type FitDimension,
} from '../../lib/discovery/fitRubric'
import type { Opportunity, PostingDetails, DiscoveryRejection } from '../../lib/types'

type LeadRow = Opportunity & { posting_details: PostingDetails | null }

const ACTION_STYLE: Record<FitAction, { label: string; cls: string }> = {
  pursue_hard: { label: 'Pursue hard', cls: 'bg-trail-50 text-trail border-trail/30' },
  pursue_lean: { label: 'Pursue lean', cls: 'bg-river-50 text-river border-river/30' },
  monitor:     { label: 'Monitor',     cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  decline:     { label: 'Decline',     cls: 'bg-gray-100 text-gray-500 border-gray-200' },
}

function scoreColor(total: number): string {
  if (total >= BAND_PURSUE_HARD) return 'bg-trail text-white'
  if (total >= BAND_PURSUE_LEAN) return 'bg-river text-white'
  return 'bg-gray-200 text-gray-600'
}

/** Seven 0–3 bars. The shape of the score is more informative than the total. */
function DimensionBars({ fit }: { fit: FitAssessment }) {
  const keys = Object.keys(DIMENSION_LABELS) as FitDimension[]
  return (
    <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5">
      {keys.map(k => {
        const v = fit.scores[k] ?? 0
        const uncertain = fit.uncertain?.includes(k)
        return (
          <div key={k} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-40 shrink-0">
              {DIMENSION_LABELS[k]}
              {uncertain && <span className="text-amber-500" title="Not stated in the posting"> ?</span>}
            </span>
            <div className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className={`w-5 h-1.5 rounded-sm ${
                    i < v ? (v === 0 ? 'bg-gray-200' : 'bg-navy') : 'bg-gray-200'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs font-medium text-navy tabular-nums">{v}</span>
          </div>
        )
      })}
    </div>
  )
}

function LeadCard({ lead, onPursue, onDecline }: {
  lead: LeadRow
  onPursue: () => void
  onDecline: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const fit = lead.ai_score_detail as FitAssessment | null
  const d = lead.posting_details
  const total = lead.ai_match_score ?? 0
  const action = fit?.action ?? 'monitor'

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start gap-4">
          <span className={`shrink-0 text-sm font-bold px-2.5 py-1.5 rounded-lg tabular-nums ${scoreColor(total)}`}>
            {total}<span className="text-[0.7em] font-medium opacity-70">/{MAX_FIT_SCORE}</span>
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="text-base font-semibold text-navy">{lead.name}</h3>
              <span className={`text-[0.7rem] font-medium px-2 py-0.5 rounded border ${ACTION_STYLE[action].cls}`}>
                {ACTION_STYLE[action].label}
              </span>
              {d?.source_kind && (
                <span className="text-[0.7rem] font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-500 uppercase tracking-wide">
                  {d.source_kind}
                </span>
              )}
            </div>

            <p className="text-sm text-gray-500 mb-2">{d?.publisher}</p>

            <div className="flex items-center gap-4 flex-wrap text-xs text-gray-400">
              {d?.location && (
                <span className="flex items-center gap-1"><MapPin size={12} />{d.location}{d.remote && ' · remote'}</span>
              )}
              {d?.closes_date && (
                <span className="flex items-center gap-1">
                  <Calendar size={12} />Closes {format(parseLocalDate(d.closes_date), 'MMM d')}
                </span>
              )}
              {d?.compensation_raw && <span>{d.compensation_raw}</span>}
              {lead.source && <span>via {lead.source}</span>}
            </div>
          </div>
        </div>

        {fit?.rationale && (
          <p className="text-sm text-gray-600 leading-relaxed mt-3 ml-[3.75rem]">{fit.rationale}</p>
        )}

        {/* Gates are the reason a high total can still read "decline" — surface them. */}
        {fit?.downgrades?.length ? (
          <div className="ml-[3.75rem] mt-2 space-y-1">
            {fit.downgrades.map((d2, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />{d2}
              </p>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2 mt-4 ml-[3.75rem] flex-wrap">
          <button
            onClick={onPursue}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-800 transition-colors"
                      title="Convert to an opportunity at the discovery stage"
          >
            Pursue
          </button>
          <button
            onClick={() => onDecline(lead.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-navy transition-colors"
          >
            Decline
          </button>
          {(d?.apply_url || lead.external_url) && (
            <a
              href={(d?.apply_url ?? lead.external_url) as string}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-river hover:text-river transition-colors"
            >
              View posting <ExternalLink size={11} />
            </a>
          )}
          <Link
            to={`/admin/opportunities/${lead.id}`}
            className="text-xs font-medium px-3 py-1.5 text-gray-400 hover:text-navy transition-colors"
          >
            Open
          </Link>
          <button
            onClick={() => setOpen(o => !o)}
            className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-navy transition-colors"
          >
            {open ? 'Hide' : 'Score'} {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {open && fit && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 space-y-4">
          <DimensionBars fit={fit} />

          {fit.green_flags?.length > 0 && (
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">Green flags</p>
              <ul className="space-y-1">
                {fit.green_flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-trail">
                    <CheckCircle2 size={12} className="mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {fit.red_flags?.length > 0 && (
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-gray-400 mb-1.5">Red flags</p>
              <ul className="space-y-1">
                {fit.red_flags.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const REASON_LABEL: Record<string, string> = {
  below_threshold: 'below threshold',
  duplicate:       'already seen',
  unscorable:      'could not score',
  incomplete:      'incomplete',
}

/**
 * What discovery dropped. Collapsed by default and placed below the queue: it is
 * reference, not work. Its job is to answer "did the pipeline find nothing, or
 * find things and rightly drop them" — the question an empty queue cannot.
 */
function RejectedPanel() {
  const [open, setOpen] = useState(false)

  const { data: rejections = [] } = useQuery<DiscoveryRejection[]>({
    queryKey: ['discovery_rejections'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_rejections')
        .select('*')
        .order('score', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return (data ?? []) as DiscoveryRejection[]
    },
  })

  if (rejections.length === 0) return null

  return (
    <div className="mt-10">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-navy transition-colors"
      >
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {rejections.length} rejected
        <span className="text-xs text-gray-300">— scored and dropped, highest first</span>
      </button>

      {open && (
        <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ul className="divide-y divide-gray-50">
            {rejections.map(r => (
              <li key={r.id} className="flex items-baseline gap-3 px-4 py-2.5">
                <span className="text-xs font-semibold tabular-nums text-gray-400 w-9 shrink-0">
                  {r.score != null ? `${r.score}/21` : '—'}
                </span>
                <span className="text-sm text-navy truncate flex-1 min-w-0">
                  {r.name}
                  {r.publisher && <span className="text-gray-400"> · {r.publisher}</span>}
                </span>
                {r.engagement_raw && (
                  <span className="text-xs text-gray-400 shrink-0 hidden md:block">{r.engagement_raw}</span>
                )}
                <span className="text-[0.7rem] text-gray-300 shrink-0 whitespace-nowrap">
                  {REASON_LABEL[r.reason] ?? r.reason}
                </span>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-300 hover:text-river transition-colors shrink-0"
                    aria-label={`View posting for ${r.name ?? 'this rejection'}`}
                  >
                    <ExternalLink size={11} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type SortKey = 'score' | 'discovered' | 'closes' | 'publisher'

const SORT_LABELS: Record<SortKey, string> = {
  score:      'Fit score',
  discovered: 'Recently found',
  closes:     'Closing soonest',
  publisher:  'Organization',
}

export function Leads() {
  const queryClient = useQueryClient()

  // Score descending is the default deliberately: the queue exists to be worked
  // top-down, and the whole point of scoring is to decide what to read first.
  const [sortKey, setSortKey]   = useState<SortKey>('score')
  const [actionFilter, setActionFilter] = useState<FitAction | ''>('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [kindFilter, setKindFilter]     = useState('')
  const [search, setSearch]             = useState('')

  const { data: leads = [], isLoading } = useQuery<LeadRow[]>({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('*, posting_details(*)')
        .eq('status', 'new')
        .order('ai_match_score', { ascending: false })
      if (error) throw error
      return (data ?? []) as LeadRow[]
    },
  })

  const sources = [...new Set((leads ?? []).map(l => l.source).filter(Boolean))] as string[]
  const kinds   = [...new Set((leads ?? []).map(l => l.posting_details?.source_kind).filter(Boolean))] as string[]

  const visible = leads
    .filter(l => {
      const fit = l.ai_score_detail as FitAssessment | null
      if (actionFilter && (fit?.action ?? 'monitor') !== actionFilter) return false
      if (sourceFilter && l.source !== sourceFilter) return false
      if (kindFilter && l.posting_details?.source_kind !== kindFilter) return false
      if (search) {
        const hay = `${l.name} ${l.posting_details?.publisher ?? ''}`.toLowerCase()
        if (!hay.includes(search.toLowerCase())) return false
      }
      return true
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'discovered':
          return new Date(b.discovered_at ?? b.created_at).getTime()
               - new Date(a.discovered_at ?? a.created_at).getTime()
        case 'closes': {
          // Undated leads sort last rather than pretending to be urgent.
          const aT = a.posting_details?.closes_date ? new Date(a.posting_details.closes_date).getTime() : Infinity
          const bT = b.posting_details?.closes_date ? new Date(b.posting_details.closes_date).getTime() : Infinity
          return aT - bT
        }
        case 'publisher':
          return (a.posting_details?.publisher ?? '').localeCompare(b.posting_details?.publisher ?? '')
        default:
          return (b.ai_match_score ?? 0) - (a.ai_match_score ?? 0)
      }
    })

  const { user, session } = useAuth()

  // Pursuing CREATES an opportunity (and an organisation for the employer) and
  // marks the lead converted — the lead itself survives, so "how many leads did
  // we act on?" stays answerable. Declining is only a status change: a declined
  // lead never becomes an opportunity and acquires none of its machinery.
  const pursue = useMutation({
    mutationFn: async (lead: LeadRow) => {
      await convertLeadToOpportunity({
        lead,
        details:     lead.posting_details,
        actorId:     user?.id ?? null,
        accessToken: session?.access_token ?? null,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
    },
  })

  const decline = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('leads')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Leads</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Discovered RFPs, contracts, and roles — scored against the fit rubric
        </p>
      </div>

      {leads.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <div className="relative flex-1 min-w-[12rem] max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search role or organization"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
            />
          </div>

          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value as FitAction | '')}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-river/20"
          >
            <option value="">All verdicts</option>
            {(Object.keys(ACTION_STYLE) as FitAction[]).map(a => (
              <option key={a} value={a}>{ACTION_STYLE[a].label}</option>
            ))}
          </select>

          {sources.length > 1 && (
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-river/20"
            >
              <option value="">All sources</option>
              {sources.map(s2 => <option key={s2} value={s2}>{s2}</option>)}
            </select>
          )}

          {kinds.length > 1 && (
            <select
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-river/20"
            >
              <option value="">All kinds</option>
              {kinds.map(k => <option key={k} value={k}>{k.toUpperCase()}</option>)}
            </select>
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            <ArrowUpDown size={13} className="text-gray-400" />
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-river/20"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                <option key={k} value={k}>{SORT_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 h-40 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-400">
            {leads.length === 0 ? 'No leads in the review queue.' : 'No leads match these filters.'}
          </p>
          <p className="text-xs text-gray-300 mt-1">
            {leads.length === 0
              ? 'Sources are checked weekly on Monday mornings.'
              : `${leads.length} in the queue — clear a filter to see them.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onPursue={() => pursue.mutate(lead)}
              onDecline={id => decline.mutate(id)}
            />
          ))}
        </div>
      )}

      <RejectedPanel />
    </div>
  )
}
