import { FunnelBar } from './FunnelBar'
import { fmtCurrency } from '../../../lib/analytics'
import type { PartnershipMetrics } from '../../../lib/analytics'

const STAGE_BAR_CLASS: Record<string, string> = {
  partnership_closed_won:  'bg-trail/30',
  partnership_closed_lost: 'bg-red-100',
}

const CONFIDENCE_BADGE: Record<string, string> = {
  low:    'bg-gray-100 text-gray-600 border-gray-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high:   'bg-green-50 text-green-700 border-green-200',
}

function KpiBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-navy">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export function PartnershipFunnel({ metrics }: { metrics: PartnershipMetrics }) {
  const { stages, winRate, avgDealAgeDays, weightedPipeline, dealsAtRisk, confidenceCounts } = metrics
  const maxCount = Math.max(...stages.map(s => s.count), 1)

  return (
    <div className="space-y-5">
      {/* Funnel chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Partnership Funnel</h2>
          {/* Confidence distribution */}
          <div className="flex items-center gap-2">
            {(['high', 'medium', 'low'] as const).map(c => (
              <span
                key={c}
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border capitalize ${CONFIDENCE_BADGE[c]}`}
              >
                {c} · {confidenceCounts[c]}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-0.5">
          {stages.map(stage => (
            <FunnelBar
              key={stage.id}
              label={stage.label}
              count={stage.count}
              maxCount={maxCount}
              value={fmtCurrency(stage.totalValue)}
              barClass={STAGE_BAR_CLASS[stage.id] ?? 'bg-trail/20'}
            />
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBox label="Win rate" value={winRate !== null ? `${winRate}%` : '—'} />
        <KpiBox
          label="Avg deal age"
          value={avgDealAgeDays !== null ? `${avgDealAgeDays}d` : '—'}
          sub="active only"
        />
        <KpiBox
          label="Weighted pipeline"
          value={weightedPipeline > 0 ? fmtCurrency(weightedPipeline) : '—'}
          sub="confidence-adjusted"
        />
        <KpiBox
          label="Deals at risk"
          value={String(dealsAtRisk)}
          sub={dealsAtRisk > 0 ? 'overdue or no next action' : 'all caught up'}
        />
      </div>

      {/* Breakdown table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">Stage</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">Count</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3 hidden sm:table-cell">Total Value</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3 hidden md:table-cell">Weighted</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">% of Pipeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {stages.map(stage => (
              <tr key={stage.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-sm text-navy">{stage.label}</td>
                <td className="px-5 py-3 text-sm font-medium text-gray-700 text-right">{stage.count}</td>
                <td className="px-5 py-3 text-sm text-gray-500 text-right hidden sm:table-cell">
                  {stage.totalValue > 0 ? fmtCurrency(stage.totalValue) : '—'}
                </td>
                <td className="px-5 py-3 text-sm text-gray-500 text-right hidden md:table-cell">
                  {stage.weightedValue > 0 ? fmtCurrency(stage.weightedValue) : '—'}
                </td>
                <td className="px-5 py-3 text-sm text-gray-500 text-right">
                  {stage.count > 0 ? `${stage.pct}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
