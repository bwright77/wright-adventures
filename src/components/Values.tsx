import { useFadeIn } from '../hooks/useFadeIn'
import { VALUES } from '../data/siteData'

function ValueCard({ value, index }: { value: typeof VALUES[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 60 })

  return (
    <div ref={ref} style={style} className="p-5 bg-white rounded-lg border border-gray-200">
      <h4 className="text-base font-semibold text-navy mb-1">{value.name}</h4>
      <p className="text-sm text-gray-500 leading-relaxed font-light">{value.description}</p>
    </div>
  )
}

export function Values() {
  return (
    <section className="py-24 px-6 lg:px-12 bg-warm-gray">
      <div className="max-w-7xl mx-auto">
        <span className="section-label">Our Values</span>
        <h2 className="section-title">What guides every engagement</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-12">
          {VALUES.map((value, i) => (
            <ValueCard key={value.name} value={value} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
