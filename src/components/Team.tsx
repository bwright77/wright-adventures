import { useFadeIn } from '../hooks/useFadeIn'
import { TEAM } from '../data/siteData'

function TeamMember({ member, index }: { member: typeof TEAM[number]; index: number }) {
  const { ref, style } = useFadeIn({ delay: index * 120 })

  return (
    <div ref={ref} style={style} className="flex flex-col sm:flex-row gap-6 items-start">
      <div
        className={`w-[88px] h-[88px] rounded-xl bg-gradient-to-br ${member.gradient} flex items-center justify-center text-white text-2xl font-bold shrink-0`}
      >
        {member.initials}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-navy mb-0.5">{member.name}</h3>
        <p className="text-sm text-earth font-medium mb-2">{member.role}</p>
        <p className="text-[0.88rem] text-gray-500 leading-relaxed font-light">{member.bio}</p>
      </div>
    </div>
  )
}

export function Team() {
  return (
    <section id="team" className="py-24 px-6 lg:px-12">
      <div className="max-w-7xl mx-auto">
        <span className="section-label">Who We Are</span>
        <h2 className="section-title">
          Two decades of experience,
          <br className="hidden sm:block" />
          one shared mission
        </h2>
        <p className="section-desc">
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
