import { FunnelBar } from './FunnelBar'
import { fmtCurrency } from '../../../lib/analytics'
import type { GrantMetrics } from '../../../lib/analytics'

const STAGE_BAR_CLASS: Record<string, string> = {
  grant_awarded: 'bg-trail/30',
  grant_declined: 'bg-red-100',
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

export function GrantFunnel({ metrics }: { metrics: GrantMetrics }) {
  const { stages, winRate, avgDaysToSubmission, totalAwarded, upcomingDeadlines } = metrics
  const maxCount = Math.max(...stages.map(s => s.count), 1)

  return (
    <div className="space-y-5">
      {/* Funnel chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">Grant Funnel</h2>
        <div className="space-y-0.5">
          {stages.map(stage => (
            <FunnelBar
              key={stage.id}
              label={stage.label}
              count={stage.count}
              maxCount={maxCount}
              value={fmtCurrency(stage.totalRequested)}
              barClass={STAGE_BAR_CLASS[stage.id] ?? 'bg-river/20'}
            />
          ))}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiBox label="Win rate" value={winRate !== null ? `${winRate}%` : '—'} />
        <KpiBox
          label="Avg days to submit"
          value={avgDaysToSubmission !== null ? `${avgDaysToSubmission}d` : '—'}
          sub="deadline − created"
        />
        <KpiBox label="Awarded (all time)" value={totalAwarded > 0 ? fmtCurrency(totalAwarded) : '—'} />
        <KpiBox label="Upcoming deadlines" value={String(upcomingDeadlines)} sub="next 30 days" />
      </div>

      {/* Breakdown table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">Stage</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">Count</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3 hidden sm:table-cell">Total Requested</th>
              <th className="text-right text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3">% of Pipeline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {stages.map(stage => (
              <tr key={stage.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-sm text-navy">{stage.label}</td>
                <td className="px-5 py-3 text-sm font-medium text-gray-700 text-right">{stage.count}</td>
                <td className="px-5 py-3 text-sm text-gray-500 text-right hidden sm:table-cell">
                  {stage.totalRequested > 0 ? fmtCurrency(stage.totalRequested) : '—'}
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
