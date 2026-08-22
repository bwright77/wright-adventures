import { Radio, ArrowUpRight } from 'lucide-react'
import { useFadeIn } from '../hooks/useFadeIn'
import { RADIO } from '../data/siteData'

/**
 * "Hear us talk about the work" — a listening invitation rather than a press
 * clipping. It sits after Team on purpose: that section says who the brothers
 * are, and this one lets you hear them say it themselves.
 *
 * White, between the dark Team section and the warm-gray Values band, so the
 * page keeps alternating rather than running two light sections together.
 */
export function OnAir() {
  const { ref, style } = useFadeIn()

  return (
    <section id="on-air" className="py-24 px-6 lg:px-12 bg-white">
      <div ref={ref} style={style} className="max-w-5xl mx-auto">
        <span className="section-label">On the Air</span>
        <h2 className="section-title">Hear us talk about the work</h2>

        <div className="mt-10 grid lg:grid-cols-[1fr_auto] gap-10 lg:gap-14 items-center">
          <div>
            {/* Her phrase, not ours — the attribution stays even though the
                full on-air story doesn't. */}
            <blockquote className="border-l-[3px] border-river pl-5 mb-7">
              <p className="text-2xl sm:text-3xl font-semibold text-navy leading-snug">
                “{RADIO.pullQuote}”
              </p>
              <cite className="block mt-2 text-sm text-gray-400 not-italic font-light">
                {RADIO.quoteSource}
              </cite>
            </blockquote>

            <div className="space-y-4 text-[0.95rem] text-gray-600 leading-relaxed font-light">
              <p>
                Shane and Ben sat down with <span className="font-medium text-navy">{RADIO.show}</span> on{' '}
                {RADIO.station} to tell the story of two brothers building together.
              </p>
              <p>
                Shane found himself guiding people down rivers and built that into two decades of
                nonprofit leadership — fundraising, strategy, and youth development that treats
                urban gardens and river corridors as the classroom. Ben came up through Seattle's
                dot-com years and a stint as a fourth-generation attorney before deciding he'd
                rather build things than pick up broken pieces, then spent twelve years engineering
                software for fintech startups.
              </p>
              <p className="text-navy font-medium">Different paths. One confluence.</p>
              <p>
                What the conversation kept circling back to is the question we open every engagement
                with: <span className="text-navy font-medium">how can we free you up to do the work
                you actually want to be doing?</span> Not build a dependency — build something you
                own and keep using long after we're gone. AI has finally put a real website, a real
                brand, and real grant capacity within reach of a one-person shop. That's the part
                worth fighting for.
              </p>
            </div>

            <a
              href={RADIO.episodeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 mt-8 bg-navy hover:bg-navy/90 text-white text-sm font-medium px-6 py-3.5 rounded-lg transition-colors"
            >
              <Radio size={17} strokeWidth={1.75} />
              Listen to the conversation
              <ArrowUpRight
                size={16}
                className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              />
            </a>
          </div>

          {/* Station card. Ordered first on small screens so the logo leads. */}
          <a
            href={RADIO.episodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="order-first lg:order-last shrink-0 flex flex-col items-center gap-4 p-8 rounded-xl bg-warm-gray border border-gray-200 hover:border-river/40 hover:shadow-sm transition-all lg:w-[248px]"
          >
            <img
              src={RADIO.logo}
              alt={RADIO.logoAlt}
              width={180}
              height={60}
              loading="lazy"
              className="w-[180px] max-w-full h-auto"
            />
            <div className="text-center">
              <p className="text-sm font-semibold text-navy">{RADIO.show}</p>
              <p className="text-xs text-gray-400 mt-0.5 font-light">{RADIO.airedOn}</p>
            </div>
          </a>
        </div>
      </div>
    </section>
  )
}
