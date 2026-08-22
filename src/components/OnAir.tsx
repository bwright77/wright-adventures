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
      {/* The divider above stays full-bleed, but the reading content is held to
          a sane measure. Inheriting the parent's 7xl ran the quotes to ~1300px —
          about 160 characters a line, double a comfortable measure — and the
          over-wide left column also sat shorter than the sidebar, so the right
          overhung it. 60rem is the widest setting where the quotes still wrap to
          a ~68-character measure; past it the line length jumps to ~102 and the
          left column collapses to two lines, which is what made the sidebar
          overhang by ~80px. Line length and column balance are the same knob. */}
      <div className="grid lg:grid-cols-[1fr_300px] gap-10 lg:gap-12 mt-8 items-start max-w-[60rem]">
        {/* Left is the conversation, right is what to take from it. The intro
            sits here rather than full-width above so the two columns carry
            comparable weight — two quotes alone left the right column
            overhanging. */}
        <div>
          <p className="text-base text-gray-600 leading-relaxed font-light mb-8">
            Shane and Ben joined {RADIO.host} on{' '}
            <span className="font-medium text-navy">{RADIO.show}</span> at {RADIO.station} — an hour
            on rivers, technology, and building for organizations that have been priced out of good
            software.
          </p>
          <div className="space-y-7">
            {RADIO.quotes.map((q, i) => (
              <Quote key={q.text} q={q} index={i} />
            ))}
          </div>
        </div>

        {/* One column, not three stranded pieces. The host's phrase anchors it,
            the station is the credential under it, and the CTA closes it — so
            the block reads as two balanced halves instead of a thin strip of
            logo beside a short list. */}
        <div className="lg:border-l lg:border-gray-300/60 lg:pl-10">
          <figure>
            <blockquote>
              <p className="text-2xl sm:text-[1.75rem] leading-tight text-navy font-bold tracking-tight">
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
            className="group block mt-6 pt-6 border-t border-gray-300/60"
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
            className="group flex items-center justify-center gap-2.5 mt-5 w-full bg-navy hover:bg-navy/90 text-white text-sm font-medium px-5 py-3.5 rounded-lg transition-colors"
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
