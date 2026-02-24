import { useState, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CASE_STUDIES } from '../data/siteData'
import lhcLogo from '../assets/images/lhc.png'
import gwdLogo from '../assets/images/gwd.png'
import ccLogo from '../assets/images/cc.png'

const ORG_LOGOS: Record<string, string> = {
  'Lincoln Hills Cares': lhcLogo,
  'GroundWork Denver': gwdLogo,
  'Confluence Colorado': ccLogo,
}

const TAG_COLORS = {
  trail: 'bg-trail-50 text-trail',
  river: 'bg-river-50 text-river',
  earth: 'bg-earth-50 text-earth',
} as const

export function CaseStudies() {
  const [current, setCurrent] = useState(0)
  const total = CASE_STUDIES.length
  const touchStartX = useRef<number | null>(null)

  const prev = () => setCurrent(i => (i - 1 + total) % total)
  const next = () => setCurrent(i => (i + 1) % total)

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const delta = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(delta) > 40) delta > 0 ? next() : prev()
    touchStartX.current = null
  }

  return (
    <section id="work" className="py-24 px-6 lg:px-12 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <span className="section-label">Our Work</span>
        <h2 className="section-title">Impact in the field</h2>
        <p className="section-desc">
          We've worked alongside organizations building pathways for youth, protecting watersheds,
          and strengthening communities across Colorado and beyond.
        </p>

        <div className="mt-12 relative">
          {/* Carousel track */}
          <div
            className="overflow-hidden rounded-xl"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${current * 100}%)` }}
            >
              {CASE_STUDIES.map(study => (
                <div
                  key={study.title}
                  className="min-w-full bg-white border border-gray-200 rounded-xl overflow-hidden"
                >
                  <div className="p-7 pb-0">
                    {ORG_LOGOS[study.title] && (
                      <img
                        src={ORG_LOGOS[study.title]}
                        alt={study.title}
                        className="h-10 w-auto object-contain mb-5"
                      />
                    )}
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
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mt-6">
            {/* Dots */}
            <div className="flex gap-2">
              {CASE_STUDIES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === current ? 'w-6 bg-navy' : 'w-2 bg-gray-300 hover:bg-gray-400'
                  }`}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>

            {/* Prev / Next */}
            <div className="flex gap-2">
              <button
                onClick={prev}
                className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-navy hover:border-navy transition-colors"
                aria-label="Previous"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={next}
                className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-navy hover:border-navy transition-colors"
                aria-label="Next"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
