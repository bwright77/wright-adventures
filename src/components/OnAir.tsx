import { Radio, ArrowUpRight } from 'lucide-react'
import { useFadeIn } from '../hooks/useFadeIn'
import { RADIO } from '../data/siteData'

/**
 * The bridge between "Who We Are" and "Our Values".
 *
 * Team states the credentials; Values states the principles. On its own that is
 * a leap — a reader has no reason to believe the values are anything more than
 * words on a page. This section closes the gap by putting the same people in
 * their own voices, unedited, on someone else's microphone. The values that
 * follow then read as a summary of what was just said rather than as a claim.
 *
 * So: no paraphrase and no restated bios. Verbatim quotes, lightly elided.
 * White, between the dark Team band and the warm-gray Values band.
 */

function Quote({ q, index }: { q: typeof RADIO.quotes[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 90 })

  return (
    <blockquote
      ref={ref}
      style={style}
      className="border-l-2 border-gray-200 pl-5 hover:border-river transition-colors"
    >
      <p className="text-[0.95rem] text-gray-600 leading-relaxed font-light">“{q.text}”</p>
      <cite className="block mt-2 text-xs font-semibold text-navy not-italic tracking-wide">
        {q.speaker}
      </cite>
    </blockquote>
  )
}

export function OnAir() {
  const { ref, style } = useFadeIn()

  return (
    <section id="on-air" className="py-24 px-6 lg:px-12 bg-white">
      <div ref={ref} style={style} className="max-w-7xl mx-auto">
        <span className="section-label">On the Air</span>
        <h2 className="section-title">In our own words</h2>
        <p className="section-desc">
          Shane and Ben joined {RADIO.host} on{' '}
          <span className="font-medium text-navy">{RADIO.show}</span> at {RADIO.station} — an hour on
          rivers, technology, and building for organizations that have been priced out of good
          software.
        </p>

        <div className="grid lg:grid-cols-[1fr_280px] gap-12 lg:gap-16 mt-12">
          <div className="space-y-7">
            {RADIO.quotes.map((q, i) => (
              <Quote key={q.text} q={q} index={i} />
            ))}
          </div>

          {/* Station card — the credential for everything quoted above. */}
          <a
            href={RADIO.episodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="order-first lg:order-last self-start w-full flex flex-col items-center gap-4 p-8 rounded-xl bg-warm-gray border border-gray-200 hover:border-river/40 hover:shadow-sm transition-all"
          >
            <img
              src={RADIO.logo}
              alt={RADIO.logoAlt}
              width={180}
              height={41}
              loading="lazy"
              className="w-[180px] max-w-full h-auto"
            />
            <div className="text-center">
              <p className="text-sm font-semibold text-navy">{RADIO.show}</p>
              <p className="text-xs text-gray-400 mt-0.5 font-light">{RADIO.airedOn}</p>
              <p className="text-[0.7rem] text-gray-400 mt-2 font-light leading-relaxed">
                {RADIO.stationDial}
              </p>
            </div>
          </a>
        </div>

        {/* The host's phrase, given the last word — it is the name for all of
            the above, and it is hers, not ours. */}
        <figure className="mt-14 border-t border-gray-100 pt-10">
          <blockquote className="max-w-3xl">
            <p className="text-xl sm:text-2xl text-navy font-medium leading-snug">
              “{RADIO.pullQuote}”
            </p>
          </blockquote>
          <figcaption className="mt-3 text-sm text-gray-400 font-light">
            {RADIO.quoteSource}
          </figcaption>
        </figure>

        <a
          href={RADIO.episodeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-2.5 mt-9 bg-navy hover:bg-navy/90 text-white text-sm font-medium px-6 py-3.5 rounded-lg transition-colors"
        >
          <Radio size={17} strokeWidth={1.75} />
          Listen to the full conversation
          <ArrowUpRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
        </a>
      </div>
    </section>
  )
}
