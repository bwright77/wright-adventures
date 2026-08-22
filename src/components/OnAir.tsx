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
      {/* The divider above stays full-bleed, but the reading content is held to
          a sane measure. Inheriting the parent's 7xl ran the quotes to ~1300px —
          about 160 characters a line, double a comfortable measure — and the
          over-wide left column also sat shorter than the sidebar, so the right
          overhung it. 60rem is the widest setting where the quotes still wrap to
          a ~68-character measure; past it the line length jumps to ~102 and the
          left column collapses to two lines, which is what made the sidebar
          overhang by ~80px. Line length and column balance are the same knob. */}
      <div className="grid lg:grid-cols-[1fr_340px] gap-10 lg:gap-12 mt-8 items-start max-w-[64rem]">
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
          <div className="space-y-4">
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
              {/* 22px against the 30px headline, so "In our own words" carries
                  the section and this defers to it — they were 28 and 30, near
                  enough to compete. At 22px the phrase needs 257px on one line
                  and the column now offers 300px, so it never wraps: breaking
                  "Responsible / technology." across two lines was killing it. */}
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
            className="group block mt-9 pt-9 border-t border-gray-300/60"
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
