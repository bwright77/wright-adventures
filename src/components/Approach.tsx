import { useFadeIn } from '../hooks/useFadeIn'
import { APPROACH_STEPS } from '../data/siteData'
import fieldTestedImg from '../assets/images/field_tested.jpg'

function ApproachStep({ step, index }: { step: typeof APPROACH_STEPS[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 100 })

  return (
    <div
      ref={ref}
      style={style}
      className="p-7 rounded-xl bg-black/50 border border-white/[0.15]"
    >
      <div className="text-5xl font-bold text-white/60 leading-none mb-4">
        {step.number}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
      <p className="text-sm text-white/80 leading-relaxed font-light">{step.description}</p>
    </div>
  )
}

export function Approach() {
  return (
    <section
      id="approach"
      className="py-24 px-6 lg:px-12 relative overflow-hidden"
      style={{ backgroundImage: `url(${fieldTestedImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
    >
      {/* Dark overlay for text legibility */}
      <div className="absolute inset-0 bg-navy/75" />
      {/* Ambient glow */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-river/[0.08] to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        <span className="section-label !text-white/80">Our Approach</span>
        <h2 className="section-title !text-white">Field-tested, not theoretical</h2>
        <p className="section-desc !text-white/80">
          We don't parachute in with frameworks. We start by understanding your place, your people,
          and what's actually in the way — then we build from there.
        </p>

        <div className="grid md:grid-cols-3 gap-5 mt-14">
          {APPROACH_STEPS.map((step, i) => (
            <ApproachStep key={step.number} step={step} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
