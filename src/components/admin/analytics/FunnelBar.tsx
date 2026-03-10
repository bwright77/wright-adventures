interface FunnelBarProps {
  label: string
  count: number
  maxCount: number
  value: string
  barClass?: string
}

export function FunnelBar({ label, count, maxCount, value, barClass = 'bg-river/20' }: FunnelBarProps) {
  const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0

  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm text-gray-500 w-28 shrink-0 text-right leading-tight">{label}</span>
      <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all duration-300 ${barClass}`}
          style={{ width: `${widthPct}%`, minWidth: count > 0 ? 4 : 0 }}
        />
      </div>
      <span className="text-sm font-semibold text-navy w-6 text-right shrink-0">{count}</span>
      <span className="text-xs text-gray-400 w-16 text-right shrink-0">{value}</span>
    </div>
  )
}
