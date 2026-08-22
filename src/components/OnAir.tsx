import { Radio, ArrowUpRight } from 'lucide-react'
import { useFadeIn } from '../hooks/useFadeIn'
import { RADIO } from '../data/siteData'

/**
 * The closing half of the Values section — NOT a section of its own.
 *
 * Six value words are a claim a reader has no reason to accept. Putting them
 * immediately above the same two people saying the same things unprompted, on
 * someone else's microphone, turns the list into evidence. So this renders
 * directly beneath the value cards and shares their cream background, which
 * also keeps the page's blue/cream alternation intact.
 *
 * No paraphrase and no restated bios. Verbatim quotes, lightly elided.
 */

// Same treatment as the service cards: white card, hairline border, and an
// always-on colour bar down the left that widens on hover. One colour per
// brother, so the two voices are distinguishable before you read the name.
//
// The bar is decorative, so the full-strength brand colours are fine there. The
// NAME is text, so it uses the -700 shades — #009DD6 measures about 3:1 at this
// size, under the 4.5:1 AA needs.
const SPEAKER: Record<string, { bar: string; name: string }> = {
  Ben:   { bar: 'bg-river', name: 'text-river-700' },
  Shane: { bar: 'bg-trail', name: 'text-trail-700' },
}

function Quote({ q, index }: { q: typeof RADIO.quotes[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 90 })
  const c = SPEAKER[q.speaker] ?? { bar: 'bg-navy', name: 'text-navy' }

  return (
    <blockquote
      ref={ref}
      style={style}
      className="group relative overflow-hidden p-5 pl-6 rounded-xl border border-gray-200/70 bg-white shadow-[0_1px_2px_rgba(0,70,103,0.04),0_10px_30px_-16px_rgba(0,70,103,0.18)] transition-all duration-300 hover:border-transparent hover:shadow-[0_16px_44px_-12px_rgba(0,70,103,0.22)] hover:-translate-y-1"
    >
      <span
        className={`absolute top-0 left-0 w-1 h-full ${c.bar} transition-all duration-300 group-hover:w-1.5`}
        aria-hidden
      />
      <p className="text-[0.95rem] text-gray-600 leading-relaxed font-light">“{q.text}”</p>
      <cite className={`block mt-3 text-xs font-semibold not-italic tracking-wide ${c.name}`}>
        {q.speaker}
      </cite>
    </blockquote>
  )
}

export function OnAir() {
  const { ref, style } = useFadeIn()

  return (
    <div id="on-air" ref={ref} style={style} className="mt-12 pt-9 border-t border-gray-200/80">
      <span className="section-label">On the Air</span>
      <h3 className="text-2xl sm:text-3xl font-bold text-navy tracking-tight mt-1">
        In our own words
      </h3>
      <div className="grid lg:grid-cols-[2fr_1fr] gap-10 lg:gap-12 mt-8 items-start">
        {/* Left is the conversation, right is what to take from it. */}
        <div>
          <p className="text-base text-gray-600 leading-relaxed font-light mb-8">
            Shane and Ben joined {RADIO.host} on{' '}
            <span className="font-medium text-navy">{RADIO.show}</span> at {RADIO.station} — an hour
            on rivers, technology, and building for organizations that have been priced out of good
            software.
          </p>
          <div className="space-y-4">
            {RADIO.quotes.map((q, i) => (
              <Quote key={q.text} q={q} index={i} />
            ))}
          </div>
        </div>

        {/* One continuous thought: the phrase is the name we're giving the
            conversation, so the show and station read as its subtitle. */}
        <div>
          <figure>
            <blockquote>
              {/* Smaller than the 30px headline so that carries the section, and
                  small enough to stay on one line. */}
              <p className="text-[1.375rem] leading-tight text-navy font-bold tracking-tight whitespace-nowrap">
                “{RADIO.pullQuote}”
              </p>
            </blockquote>
            <figcaption className="mt-2.5 text-xs text-gray-600 leading-relaxed">
              {RADIO.quoteSource}
            </figcaption>
          </figure>

          <a
            href={RADIO.episodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block mt-7"
          >
            <img
              src={RADIO.logo}
              alt={RADIO.logoAlt}
              width={124}
              height={29}
              loading="lazy"
              className="w-[124px] max-w-full h-auto opacity-90 group-hover:opacity-100 transition-opacity"
            />
            <p className="mt-3 text-sm font-semibold text-navy">{RADIO.show}</p>
            <p className="text-xs text-gray-600 mt-1">{RADIO.airedOn}</p>
            <p className="text-xs text-gray-600 mt-1">{RADIO.stationDial}</p>
          </a>

          <a
            href={RADIO.episodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-center gap-2.5 mt-7 w-full bg-navy hover:bg-navy/90 text-white text-sm font-medium px-5 py-3.5 rounded-lg transition-colors"
          >
            <Radio size={17} strokeWidth={1.75} />
            Listen to the conversation
            <ArrowUpRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </a>
        </div>
      </div>
    </div>
  )
}
