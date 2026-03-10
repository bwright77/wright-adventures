interface MetricCardProps {
  label: string
  value: string | number
  sub?: string
  accent?: 'navy' | 'river' | 'trail' | 'earth'
}

const ACCENT_CLASSES: Record<NonNullable<MetricCardProps['accent']>, string> = {
  navy:  'text-navy',
  river: 'text-river',
  trail: 'text-trail',
  earth: 'text-earth',
}

export function MetricCard({ label, value, sub, accent = 'navy' }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${ACCENT_CLASSES[accent]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
