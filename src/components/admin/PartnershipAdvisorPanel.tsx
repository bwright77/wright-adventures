import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, RefreshCw, AlertCircle, CheckCircle, HelpCircle, AlertTriangle, Star } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../contexts/AuthContext'
import type { AdvisorResponse, AdvisorRecommendation } from '../../lib/types'

// ── Fit score display ─────────────────────────────────────────
const FIT_LABELS: Record<number, string> = {
  1: 'Weak fit',
  2: 'Low fit',
  3: 'Moderate fit',
  4: 'Strong fit',
  5: 'Excellent fit',
}

const FIT_COLORS: Record<number, string> = {
  1: 'text-red-600',
  2: 'text-amber-600',
  3: 'text-amber-500',
  4: 'text-green-600',
  5: 'text-green-700',
}

function FitScore({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            size={14}
            className={i <= score ? FIT_COLORS[score] : 'text-gray-200'}
            fill={i <= score ? 'currentColor' : 'none'}
          />
        ))}
      </div>
      <span className={`text-sm font-semibold ${FIT_COLORS[score]}`}>
        {FIT_LABELS[score]}
      </span>
    </div>
  )
}

// ── Section components ────────────────────────────────────────
function Section({ title, icon, children }: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-gray-400">{icon}</span>
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-[0.08em]">{title}</span>
      </div>
      {children}
    </div>
  )
}

function BulletList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className={`flex gap-2 text-sm text-gray-700 ${className}`}>
          <span className="text-gray-300 shrink-0 mt-0.5">·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

// ── Recommendation display ────────────────────────────────────
function RecommendationCard({
  recommendation,
  cached,
  onRefresh,
  refreshing,
}: {
  recommendation: AdvisorRecommendation
  cached: boolean
  onRefresh: () => void
  refreshing: boolean
}) {
  const isStale = cached && recommendation.generated_at
    ? Date.now() - new Date(recommendation.generated_at).getTime() > 6 * 24 * 60 * 60 * 1000
    : false

  return (
    <div className="space-y-4">
      {/* Fit score + staleness */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          {recommendation.fit_score !== null && (
            <FitScore score={recommendation.fit_score} />
          )}
          {recommendation.fit_rationale && (
            <p className="text-sm text-gray-600">{recommendation.fit_rationale}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isStale && (
            <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              Outdated
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-trail transition-colors disabled:opacity-40"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          {recommendation.generated_at && (
            <span className="text-[10px] text-gray-400">
              {formatDistanceToNow(new Date(recommendation.generated_at), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      {/* Recommended services */}
      {recommendation.recommended_services.length > 0 && (
        <Section title="Recommended services" icon={<CheckCircle size={12} />}>
          <div className="space-y-2">
            {recommendation.recommended_services.map((svc, i) => (
              <div key={i} className="flex gap-2.5">
                <span className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                  svc.priority === 'primary'
                    ? 'bg-trail/10 text-trail'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {svc.priority}
                </span>
                <div>
                  <p className="text-sm font-medium text-navy">{svc.service}</p>
                  <p className="text-xs text-gray-500">{svc.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Talking points */}
      {recommendation.talking_points.length > 0 && (
        <Section title="Talking points" icon={<Sparkles size={12} />}>
          <BulletList items={recommendation.talking_points} />
        </Section>
      )}

      {/* Open questions */}
      {recommendation.open_questions.length > 0 && (
        <Section title="Open questions" icon={<HelpCircle size={12} />}>
          <BulletList items={recommendation.open_questions} className="text-gray-600" />
        </Section>
      )}

      {/* Watch-outs */}
      {recommendation.watch_outs.length > 0 && (
        <Section title="Watch-outs" icon={<AlertTriangle size={12} />}>
          <BulletList items={recommendation.watch_outs} className="text-amber-700" />
        </Section>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function PartnershipAdvisorPanel({ opportunityId }: { opportunityId: string }) {
  const { session, profile } = useAuth()
  const queryClient = useQueryClient()

  const canGenerate = profile?.role === 'admin' || profile?.role === 'manager'

  const { data, isLoading, isFetching } = useQuery<AdvisorResponse>({
    queryKey: ['advisor', opportunityId],
    queryFn: async () => {
      const res = await fetch('/api/partnerships/recommend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ opportunity_id: opportunityId }),
      })
      return res.json()
    },
    staleTime: Infinity,
    enabled: canGenerate,
  })

  async function refresh() {
    const res = await fetch('/api/partnerships/recommend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ opportunity_id: opportunityId, force_refresh: true }),
    })
    const json = await res.json() as AdvisorResponse
    queryClient.setQueryData(['advisor', opportunityId], json)
  }

  // Viewer — read-only if there's a cached recommendation available
  if (!canGenerate) {
    return (
      <div className="py-6 text-center">
        <p className="text-sm text-gray-400">
          AI recommendations are available to admins and managers.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="py-8 flex flex-col items-center gap-2">
        <div className="w-5 h-5 border-2 border-trail border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Analyzing opportunity…</p>
      </div>
    )
  }

  // Error from AI
  if (data?.error) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} />
          {data.error}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-trail hover:text-trail/80 transition-colors"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          Try again
        </button>
      </div>
    )
  }

  // Insufficient data
  if (data?.message && !data.recommendation) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>{data.message}</span>
        </div>
        <p className="text-xs text-gray-400">
          Fill in the opportunity description and key pain points, then generate a recommendation.
        </p>
      </div>
    )
  }

  // No data yet — first generation
  if (!data?.recommendation) {
    return (
      <div className="py-6 flex flex-col items-center gap-3 text-center">
        <Sparkles size={24} className="text-trail/60" />
        <div>
          <p className="text-sm font-medium text-navy">Generate a solution recommendation</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Claude will analyze this opportunity and suggest the best-fit WA service areas,
            talking points, and open questions.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-sm font-medium bg-trail hover:bg-trail/90 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {isFetching ? (
            <div className="w-3.5 h-3.5 border border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <Sparkles size={14} />
          )}
          {isFetching ? 'Analyzing…' : 'Generate recommendation'}
        </button>
      </div>
    )
  }

  return (
    <RecommendationCard
      recommendation={data.recommendation}
      cached={data.cached}
      onRefresh={refresh}
      refreshing={isFetching}
    />
  )
}
