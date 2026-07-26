import { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { CASE_STUDIES } from '../data/siteData'
import lhcLogo from '../assets/images/lhc.png'
import gwdLogo from '../assets/images/gwd.png'
import ccLogo from '../assets/images/cc.png'
import cmcLogo from '../assets/images/cmc.png'
import pfbMark from '../assets/images/pfb-mark.png'
import pfbLogo from '../assets/images/pfb.png'
import bbspLogo from '../assets/images/bbsp.svg'
import kadyLogo from '../assets/images/kady.svg'

const ORG_LOGOS: Record<string, string | string[]> = {
  'Lincoln Hills Cares': lhcLogo,
  'GroundWork Denver': gwdLogo,
  'Confluence Colorado': ccLogo,
  'Colorado Mountain Club': cmcLogo,
  'PeopleForBikes — Better Bike Share Partnership': [pfbMark, pfbLogo, bbspLogo],
  'Kady Youth Sheep Camp': kadyLogo,
}

const TAG_COLORS = {
  trail: 'bg-trail-50 text-trail',
  river: 'bg-river-50 text-river',
  earth: 'bg-earth-50 text-earth',
} as const

// Top accent bar, keyed to the same tagColor as the badge.
const ACCENT_COLORS = {
  trail: 'bg-trail',
  river: 'bg-river',
  earth: 'bg-earth',
} as const

export function CaseStudies() {
  const [current, setCurrent] = useState(0)
  const total = CASE_STUDIES.length
  const touchStartX = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const next = useCallback(() => setCurrent(i => (i + 1) % total), [total])
  const prev = () => setCurrent(i => (i - 1 + total) % total)

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(next, 10_000)
  }, [next])

  useEffect(() => {
    resetTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [resetTimer])

  const goTo = (i: number) => { setCurrent(i); resetTimer() }
  const handlePrev = () => { prev(); resetTimer() }
  const handleNext = () => { next(); resetTimer() }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const delta = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(delta) > 40) delta > 0 ? handleNext() : handlePrev()
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
          {/* pb-8 leaves room for the card's drop shadow, which overflow-hidden would otherwise clip */}
          <div
            className="overflow-hidden rounded-xl pb-8"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <div
              className="flex transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${current * 100}%)` }}
            >
              {CASE_STUDIES.map((study, slide) => {
                const url = 'url' in study ? study.url : undefined
                return (
                <div
                  key={study.title}
                  // Off-screen slides stay in the DOM; keep their links out of the tab order.
                  inert={slide !== current}
                  aria-hidden={slide !== current}
                  className="min-w-full bg-white border border-gray-200/70 rounded-xl overflow-hidden relative shadow-[0_2px_4px_rgba(0,70,103,0.04),0_18px_48px_-18px_rgba(0,70,103,0.28)]"
                >
                  <div className={`h-1 w-full ${ACCENT_COLORS[study.tagColor]}`} />

                  <div className="p-7 pb-0">
                    {ORG_LOGOS[study.title] && (
                      <div className="flex items-center gap-4 mb-5">
                        {(Array.isArray(ORG_LOGOS[study.title])
                          ? ORG_LOGOS[study.title] as string[]
                          : [ORG_LOGOS[study.title] as string]
                        ).map((logo, i) => (
                          <img
                            key={i}
                            src={logo}
                            alt={study.title}
                            className="h-10 w-auto object-contain"
                          />
                        ))}
                      </div>
                    )}
                    <span
                      className={`inline-block text-[0.72rem] font-semibold uppercase tracking-[0.1em] px-2.5 py-1 rounded mb-4 ${TAG_COLORS[study.tagColor]}`}
                    >
                      {study.tag}
                    </span>
                    <h3 className="text-xl font-semibold text-navy mb-2">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${study.title} — visit site (opens in a new tab)`}
                          className="group/link inline-flex items-center gap-1.5 hover:text-river transition-colors"
                        >
                          {study.title}
                          <ExternalLink
                            size={15}
                            className="text-gray-400 shrink-0 transition-colors group-hover/link:text-river"
                          />
                        </a>
                      ) : (
                        study.title
                      )}
                    </h3>
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
              })}
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mt-2">
            {/* Dots */}
            <div className="flex gap-2">
              {CASE_STUDIES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
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
                onClick={handlePrev}
                className="p-2 rounded-full border border-gray-200 text-gray-400 hover:text-navy hover:border-navy transition-colors"
                aria-label="Previous"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={handleNext}
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
