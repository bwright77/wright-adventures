import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { computeGrantMetrics, computePartnershipMetrics, fmtCurrency } from '../../lib/analytics'
import type { OpportunityWithDetails } from '../../lib/analytics'
import { MetricCard } from '../../components/admin/analytics/MetricCard'
import { GrantFunnel } from '../../components/admin/analytics/GrantFunnel'
import { PartnershipFunnel } from '../../components/admin/analytics/PartnershipFunnel'

type Tab = 'grants' | 'partnerships'

export function Analytics() {
  const [tab, setTab] = useState<Tab>('grants')

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

  const grantMetrics       = computeGrantMetrics(opportunities)
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
            label="Active Grants"
            value={grantMetrics.activeCount}
            sub="in pipeline"
          />
          <MetricCard
            label="Grant Pipeline"
            value={fmtCurrency(grantMetrics.totalPipelineValue)}
            sub="total requested"
            accent="river"
          />
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
        </div>
      )}

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
        {(['grants', 'partnerships'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
            }`}
          >
            {t === 'grants' ? 'Grants' : 'Partnerships'}
          </button>
        ))}
      </div>

      {/* Panel */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-gray-200 h-64 animate-pulse" />
      ) : tab === 'grants' ? (
        <GrantFunnel metrics={grantMetrics} />
      ) : (
        <PartnershipFunnel metrics={partnershipMetrics} />
      )}
    </div>
  )
}
