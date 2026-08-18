import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { computePartnershipMetrics, fmtCurrency } from '../../lib/analytics'
import type { OpportunityWithDetails } from '../../lib/analytics'
import { MetricCard } from '../../components/admin/analytics/MetricCard'
import { PartnershipFunnel } from '../../components/admin/analytics/PartnershipFunnel'

export function Analytics() {
  // Shares cache with Opportunities.tsx via the same query key
  const { data: opportunities = [], isLoading } = useQuery<OpportunityWithDetails[]>({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*, partnership_details(logo_url, confidence, next_action_date)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OpportunityWithDetails[]
    },
  })

  const partnershipMetrics = computePartnershipMetrics(opportunities)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Pipeline Analytics</h1>
        <p className="text-sm text-gray-400 mt-0.5">Funnel health and conversion metrics</p>
      </div>

      {/* Summary bar */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 h-[84px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <MetricCard
            label="Active Partnerships"
            value={partnershipMetrics.activeCount}
            sub="in pipeline"
            accent="trail"
          />
          <MetricCard
            label="Partnership Pipeline"
            value={fmtCurrency(partnershipMetrics.totalPipelineValue)}
            sub="estimated value"
            accent="earth"
          />
          <MetricCard
            label="Win Rate"
            value={partnershipMetrics.winRate != null ? `${partnershipMetrics.winRate}%` : '—'}
            sub="closed-won share"
            accent="river"
          />
          <MetricCard
            label="Weighted Pipeline"
            value={fmtCurrency(partnershipMetrics.weightedPipeline)}
            sub="by confidence"
          />
        </div>
      )}

      {/* Panel */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 h-64 animate-pulse" />
      ) : (
        <PartnershipFunnel metrics={partnershipMetrics} />
      )}
    </div>
  )
}
