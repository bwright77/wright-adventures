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

function Quote({ q, index }: { q: typeof RADIO.quotes[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 90 })

  return (
    <blockquote
      ref={ref}
      style={style}
      className="border-l-2 border-gray-300/70 pl-5 hover:border-river transition-colors"
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
    <div id="on-air" ref={ref} style={style} className="mt-12 pt-9 border-t border-gray-200/80">
      <span className="section-label">On the Air</span>
      <h3 className="text-2xl sm:text-3xl font-bold text-navy tracking-tight mt-1">
        In our own words
      </h3>
      <p className="mt-3 text-base text-gray-600 max-w-2xl leading-relaxed font-light">
        Shane and Ben joined {RADIO.host} on{' '}
        <span className="font-medium text-navy">{RADIO.show}</span> at {RADIO.station} — an hour on
        rivers, technology, and building for organizations that have been priced out of good
        software.
      </p>

      <div className="grid lg:grid-cols-[1fr_200px] gap-10 lg:gap-14 mt-10">
        <div className="space-y-7">
          {RADIO.quotes.map((q, i) => (
            <Quote key={q.text} q={q} index={i} />
          ))}
        </div>

        {/* Station lockup — the credential for everything quoted above. No
            card: boxing it left a large pale rectangle of dead space beside a
            short column of quotes. */}
        <a
          href={RADIO.episodeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="order-first lg:order-last self-start group block lg:border-l lg:border-gray-200/80 lg:pl-8"
        >
          <img
            src={RADIO.logo}
            alt={RADIO.logoAlt}
            width={132}
            height={30}
            loading="lazy"
            className="w-[132px] max-w-full h-auto opacity-90 group-hover:opacity-100 transition-opacity"
          />
          {/* gray-400 on the cream measures 2.29:1 where AA wants 4.5:1, and
              0.7rem made it worse. gray-600 is 6.82:1; nothing goes below xs. */}
          <p className="mt-3 text-sm font-semibold text-navy">{RADIO.show}</p>
          <p className="text-xs text-gray-600 mt-1">{RADIO.airedOn}</p>
          <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{RADIO.stationDial}</p>
        </a>
      </div>

      {/* The host's phrase gets the last word: the two words are the whole
          point, and the sentence they arrived in only diluted them. */}
      <figure className="mt-11 border-t border-gray-200/80 pt-9">
        <blockquote>
          <p className="text-3xl sm:text-4xl text-navy font-bold tracking-tight">
            “{RADIO.pullQuote}”
          </p>
        </blockquote>
        <figcaption className="mt-3 text-sm text-gray-600 max-w-xl">
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
  )
}
