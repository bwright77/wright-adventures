import { useFadeIn } from '../hooks/useFadeIn'
import { CASE_STUDIES } from '../data/siteData'

const TAG_COLORS = {
  trail: 'bg-trail-50 text-trail',
  river: 'bg-river-50 text-river',
} as const

function CaseCard({ study, index }: { study: typeof CASE_STUDIES[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 120 })

  return (
    <div
      ref={ref}
      style={style}
      className="bg-white rounded-xl border border-gray-200 overflow-hidden transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,70,103,0.08)] hover:-translate-y-0.5"
    >
      <div className="p-7 pb-0">
        <span
          className={`inline-block text-[0.72rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 rounded mb-4 ${TAG_COLORS[study.tagColor]}`}
        >
          {study.tag}
        </span>
        <h3 className="text-xl font-semibold text-navy mb-2">{study.title}</h3>
      </div>

      <div className="px-7 pb-6">
        <p className="text-[0.92rem] text-gray-500 leading-relaxed font-light">
          {study.description}
        </p>
      </div>

      <div className="flex gap-8 px-7 py-5 border-t border-gray-100">
        {study.metrics.map((metric, i) => (
          <div key={i}>
            <strong className="block text-2xl font-bold text-navy leading-tight">
              {metric.value}
            </strong>
            <span className="text-xs text-gray-400">{metric.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CaseStudies() {
  return (
    <section id="work" className="py-24 px-6 lg:px-12 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <span className="section-label">Our Work</span>
        <h2 className="section-title">Impact in the field</h2>
        <p className="section-desc">
          We've worked alongside organizations building pathways for youth, protecting watersheds,
          and strengthening communities across Colorado and beyond.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-12">
          {CASE_STUDIES.map((study, i) => (
            <CaseCard key={study.title} study={study} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
