import { ArrowRight } from 'lucide-react'
import { STATS } from '../data/siteData'

export function Hero() {
  return (
    <section className="min-h-screen flex items-center relative overflow-hidden bg-gradient-to-br from-navy via-navy-800 to-navy-900">
      {/* Ambient light effects */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[10%] right-[10%] w-[60%] h-[60%] bg-river/[0.08] rounded-full blur-[120px]" />
        <div className="absolute bottom-[10%] left-[5%] w-[40%] h-[40%] bg-trail/[0.06] rounded-full blur-[100px]" />
        <div className="absolute top-[40%] left-[40%] w-[30%] h-[30%] bg-earth/[0.04] rounded-full blur-[80px]" />
      </div>

      {/* Topo pattern overlay */}
      <div className="absolute inset-0 topo-pattern opacity-[0.04] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-12 pt-32 pb-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center w-full">
        {/* Left — copy */}
        <div className="animate-fade-in-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-river/[0.12] border border-river/25 rounded-full text-river text-xs font-medium uppercase tracking-[0.06em] mb-6">
            <span className="w-1.5 h-1.5 bg-river rounded-full animate-pulse-dot" />
            Empowering Organizations to Do More
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-bold text-white leading-[1.12] tracking-tight mb-6">
            Building the Pathways to{' '}
            <br className="hidden sm:block" />
            <em className="not-italic text-river">Connect People to Place.</em>
          </h1>

          <p className="text-lg text-white/60 leading-relaxed mb-10 max-w-xl font-light">
            Strategic consulting, fundraising support, AI-powered tools, and program design for community,
            environmental, natural resource, and youth development organizations ready to scale their impact
            and grow the next generation of stewards.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a href="#contact" className="btn-primary text-base">
              Let's talk about your organization
              <ArrowRight size={16} />
            </a>
            <a
              href="#work"
              className="btn-secondary text-white/80 border-white/20 hover:bg-white/[0.06] hover:border-white/30 hover:text-white"
            >
              See our work
            </a>
          </div>
        </div>

        {/* Right — stats card */}
        <div className="animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-8 backdrop-blur-sm">
            <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-white/40 mb-7">
              Track Record
            </h3>
            {STATS.map((stat, i) => (
              <div
                key={i}
                className={`flex items-baseline gap-4 py-5 ${
                  i < STATS.length - 1 ? 'border-b border-white/[0.06]' : ''
                }`}
              >
                <span className="text-4xl lg:text-[2.4rem] font-bold text-white leading-none min-w-[120px]">
                  {stat.value}
                  <span className="text-xl font-normal text-river">{stat.unit}</span>
                </span>
                <span className="text-sm text-white/50 font-light leading-snug">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
