import { Network, Cpu, type LucideProps } from 'lucide-react'
import { useFadeIn } from '../hooks/useFadeIn'
import { TEAM } from '../data/siteData'
import shaneAndBen from '../assets/images/shane_and_ben.jpeg'

const TEAM_ICONS: Record<string, React.ComponentType<LucideProps>> = {
  Network,
  Cpu,
}

function TeamMember({ member, index }: { member: typeof TEAM[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 120 })

  return (
    <div ref={ref} style={style} className="flex flex-col sm:flex-row gap-6 items-start p-6 rounded-xl bg-black/30 border border-white/[0.12] backdrop-blur-sm">
      <div
        className={`w-[88px] h-[88px] rounded-xl bg-gradient-to-br ${member.gradient} flex items-center justify-center text-white shrink-0`}
      >
        {(() => { const Icon = TEAM_ICONS[member.icon]; return Icon ? <Icon size={36} strokeWidth={1.5} /> : null })()}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white mb-0.5">{member.name}</h3>
        <p className="text-sm text-river font-medium mb-2">{member.role}</p>
        <p className="text-[0.88rem] text-white/80 leading-relaxed font-light">{member.bio}</p>
      </div>
    </div>
  )
}

export function Team() {
  return (
    <section
      id="team"
      className="py-24 px-6 lg:px-12 relative overflow-hidden"
    >
      {/* Flipped background image */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `url(${shaneAndBen})`, backgroundSize: 'cover', backgroundPosition: 'center 20%', transform: 'scaleX(-1)' }}
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-navy/80" />

      <div className="max-w-7xl mx-auto relative z-10">
        <span className="section-label !text-white/80">Who We Are</span>
        <h2 className="section-title !text-white">
          Two decades of experience,
          <br className="hidden sm:block" />
          one shared mission
        </h2>
        <p className="section-desc !text-white/80">
          Wright Adventures is led by two brothers with complementary expertise — deep field
          experience in conservation and youth development, combined with technology leadership and
          legal acumen.
        </p>

        <div className="grid md:grid-cols-2 gap-10 mt-12">
          {TEAM.map((member, i) => (
            <TeamMember key={member.name} member={member} index={i} />
          ))}
        </div>
      </div>
    </section>
  )
}
