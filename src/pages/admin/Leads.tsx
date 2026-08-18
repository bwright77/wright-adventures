import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ChevronDown, ChevronUp, MapPin, Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { parseLocalDate } from '../../lib/dates'
import {
  DIMENSION_LABELS, MAX_FIT_SCORE, BAND_PURSUE_HARD, BAND_PURSUE_LEAN,
  type FitAssessment, type FitAction, type FitDimension,
} from '../../lib/discovery/fitRubric'
import type { Opportunity, LeadDetails, DiscoveryRejection } from '../../lib/types'

type LeadRow = Opportunity & { lead_details: LeadDetails | null }

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
  onPursue: (id: string) => void
  onDecline: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const fit = lead.ai_score_detail as FitAssessment | null
  const d = lead.lead_details
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
            onClick={() => onPursue(lead.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-800 transition-colors"
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

export function Leads() {
  const queryClient = useQueryClient()

  const { data: leads = [], isLoading } = useQuery<LeadRow[]>({
    queryKey: ['leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, lead_details(*)')
        .eq('type_id', 'lead')
        .eq('status', 'lead_discovered')
        .order('ai_match_score', { ascending: false })
      if (error) throw error
      return (data ?? []) as LeadRow[]
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ status, updated_at: new Date().toISOString() })
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
          Discovered RFPs, contracts, and roles — scored against the fit rubric, highest first
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 h-40 animate-pulse" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <p className="text-sm text-gray-400">No leads in the review queue.</p>
          <p className="text-xs text-gray-300 mt-1">
            Sources are checked weekly on Monday mornings.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {leads.map(lead => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onPursue={id => setStatus.mutate({ id, status: 'lead_evaluating' })}
              onDecline={id => setStatus.mutate({ id, status: 'lead_declined' })}
            />
          ))}
        </div>
      )}

      <RejectedPanel />
    </div>
  )
}
