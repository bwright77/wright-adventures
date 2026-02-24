import { Layers, Users, Shield, Monitor } from 'lucide-react'
import { useFadeIn } from '../hooks/useFadeIn'
import { SERVICES } from '../data/siteData'

const ICONS = {
  layers: Layers,
  users: Users,
  shield: Shield,
  monitor: Monitor,
} as const

const COLOR_MAP = {
  river: {
    iconBg: 'bg-river-50',
    iconText: 'text-river',
    accent: 'bg-river',
  },
  trail: {
    iconBg: 'bg-trail-50',
    iconText: 'text-trail',
    accent: 'bg-trail',
  },
  earth: {
    iconBg: 'bg-earth-50',
    iconText: 'text-earth',
    accent: 'bg-earth',
  },
  navy: {
    iconBg: 'bg-navy-50',
    iconText: 'text-navy',
    accent: 'bg-navy',
  },
} as const

function ServiceCard({ service, index }: { service: typeof SERVICES[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 80 })
  const Icon = ICONS[service.icon]
  const colors = COLOR_MAP[service.color]

  return (
    <div
      ref={ref}
      style={style}
      className="group p-7 rounded-xl border border-gray-200 bg-white relative overflow-hidden transition-all duration-300 hover:border-transparent hover:shadow-[0_12px_40px_rgba(0,70,103,0.1)] hover:-translate-y-1"
    >
      {/* Accent bar on hover */}
      <div className={`absolute top-0 left-0 w-1 h-full ${colors.accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />

      <div className={`w-11 h-11 rounded-lg ${colors.iconBg} ${colors.iconText} flex items-center justify-center mb-5`}>
        <Icon size={22} />
      </div>

      <h3 className="text-xl font-semibold text-navy mb-1.5">{service.title}</h3>
      <p className="text-sm text-earth font-medium italic mb-3">{service.outcome}</p>
      <p className="text-[0.92rem] text-gray-500 leading-relaxed font-light">{service.description}</p>
    </div>
  )
}

export function Services() {
  return (
    <section id="services" className="py-24 px-6 lg:px-12">
      <div className="max-w-7xl mx-auto">
        <div className="mb-14">
          <span className="section-label">What We Do</span>
          <h2 className="section-title">
            Services built around{' '}
            <br className="hidden sm:block" />
            what you actually need
          </h2>
          <p className="section-desc">
            We organize our work around your outcomes — not our org chart. Every engagement is scoped
            to the specific job your organization is trying to get done.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {SERVICES.map((service, i) => (
            <ServiceCard key={service.title} service={service} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
