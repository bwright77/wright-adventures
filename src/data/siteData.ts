// ============================================================
// Wright Adventures — Brand Constants & Site Data
// ============================================================

export const BRAND = {
  name: 'Wright Adventures',
  tagline: 'Nonprofit Advisory & Technology',
  email: 'info@wrightadventures.org',
  phone: '(303) 815-7613',
  phoneHref: 'tel:+13038157613',
  linkedin: 'https://www.linkedin.com/in/benjamin-robert-wright/',
  location: 'Denver, Colorado',
} as const

export const NAV_LINKS = [
  { label: 'What We Do', href: '#services' },
  { label: 'Our Approach', href: '#approach' },
  { label: 'Our Work', href: '#work' },
  { label: 'Who We Are', href: '#team' },
] as const

export const STATS = [
  { value: '$15M', unit: '+', label: 'Raised for youth conservation and community health programs creating pathways to environmental careers and community leadership' },
  { value: '800', unit: '+', label: 'Youth directly employed in programs we built — watershed restoration, tree planting, trail crews, and urban conservation' },
  { value: '30', unit: '+ yrs', label: 'Combined experience in nonprofit leadership & technology' },
] as const

export const SERVICES = [
  {
    title: 'Grow Your Funding',
    outcome: 'Go from chasing grants to building a funding engine.',
    description: 'Grant strategy development, AI-assisted proposal writing, funder positioning, and reporting systems that demonstrate impact clearly. We\'ve helped partners secure millions — and we build the tools to help you do it repeatably.',
    color: 'river' as const,
    icon: 'layers',
  },
  {
    title: 'Build Your Programs',
    outcome: 'Design pathways that actually connect youth to careers and communities to nature.',
    description: 'Youth workforce development, environmental stewardship curriculum, community engagement strategy, and program evaluation. Grounded in 20+ years of field experience across conservation, education, and public health.',
    color: 'trail' as const,
    icon: 'users',
  },
  {
    title: 'Navigate Compliance',
    outcome: 'Stop letting regulations be a barrier to the resources your community needs.',
    description: 'Regulatory framework navigation, reporting compliance, policy alignment, and legal strategy for nonprofits working at the intersection of environment, health, and community development. Built on a legal background and real-world practice.',
    color: 'earth' as const,
    icon: 'shield',
  },
  {
    title: 'Scale With Technology',
    outcome: 'Access the tools big organizations use — at a price your nonprofit can afford.',
    description: 'AI-powered grant writing assistants, program management dashboards, watershed monitoring platforms, and impact tracking tools. We build accessible technology for communities that have been priced out of software.',
    color: 'navy' as const,
    icon: 'monitor',
  },
] as const

export const APPROACH_STEPS = [
  {
    number: '01',
    title: 'Listen & Map',
    description: 'We learn your organization from the inside — your mission, your community, your constraints. We identify the specific jobs your team is trying to get done and where the gaps are.',
  },
  {
    number: '02',
    title: 'Design & Build',
    description: 'We co-create solutions with you — not for you. Whether that\'s a funding strategy, a technology tool, or a program redesign, we work iteratively so you can course-correct in real time.',
  },
  {
    number: '03',
    title: 'Transfer & Sustain',
    description: 'We build your capacity, not dependency. Every engagement ends with your team owning the systems, tools, and knowledge to sustain the work independently.',
  },
] as const

export const CASE_STUDIES = [
  {
    tag: 'Brand & Technology',
    tagColor: 'earth' as const,
    title: 'Confluence Colorado',
    description: 'Built Confluence Colorado\'s brand identity from the ground up — logo, visual language, and messaging — then designed and launched their website. We continue to manage their technology infrastructure and lead their grant management strategy, serving as an ongoing strategic and operational partner.',
    metrics: [
      { value: 'Full build', label: 'Brand, web & tech' },
      { value: 'Ongoing', label: 'Strategy & tech partner' },
    ],
  },
  {
    tag: 'Conservation & Community',
    tagColor: 'river' as const,
    title: 'GroundWork Denver',
    description: 'Built grant strategy and program design capacity for urban youth conservation and community health programs, creating pathways that connect young people to environmental careers and community leadership.',
    metrics: [
      { value: '$3M+', label: 'Total funds raised' },
      { value: 'Youth & watershed', label: 'Dual-impact programs' },
    ],
  },
  {
    tag: 'Youth Pathways',
    tagColor: 'trail' as const,
    title: 'Lincoln Hills Cares',
    description: 'Developed sustainable funding strategy and program infrastructure for workforce pathways programs connecting underserved youth to careers in conservation and environmental stewardship at the historic Lincoln Hills site.',
    metrics: [
      { value: '$700K+', label: 'Annual funding secured' },
      { value: 'Youth & conservation', label: 'Workforce pathways' },
    ],
  },
  {
    tag: 'Hiring & Operations',
    tagColor: 'river' as const,
    title: 'Colorado Mountain Club',
    description: 'Supporting the Colorado Mountain Club across hiring, program direction, and program operations — helping one of the nation\'s leading mountain recreation organizations build staff capacity, sharpen program delivery, and navigate compliance and licensing requirements.',
    metrics: [
      { value: 'Active', label: 'Current engagement' },
      { value: 'Hiring, ops & compliance', label: 'Full scope support' },
    ],
  },
] as const

export const TEAM = [
  {
    name: 'Shane Wright',
    role: 'Founder & Executive Director',
    icon: 'Network',
    gradient: 'from-trail to-[#5A9C6D]',
    bio: '20+ years leading youth development, conservation, and community programs across Colorado. Former director of GroundWork Denver and architect of the Lincoln Hills Cares pathways initiative. Deep relationships across the nonprofit, foundation, and government sectors.',
  },
  {
    name: 'Benjamin Wright',
    role: 'Director of Technology & Innovation',
    icon: 'Cpu',
    gradient: 'from-river to-[#0080B0]',
    bio: '10+ years leading engineering teams at organizations including Paytient and Maxwell Financial Labs. JD from University of Denver with 6 years of legal practice. Builds AI-powered tools that make enterprise-grade software accessible to mission-driven organizations.',
  },
] as const

export const VALUES = [
  { name: 'Connection', description: 'Building meaningful relationships between people, communities, and the places they call home.' },
  { name: 'Empowerment', description: 'Creating pathways — physical and digital — that help people and organizations build their own capacity.' },
  { name: 'Stewardship', description: 'Protecting the health and resilience of the ecosystems and communities we serve.' },
  { name: 'Collaboration', description: 'Working alongside partners as co-creators, never as outsiders imposing solutions.' },
  { name: 'Equity', description: 'Ensuring underserved communities have access to the same tools, resources, and opportunities as everyone else.' },
  { name: 'Empathy', description: 'Leading with understanding. Every community and every organization has a unique story and context.' },
] as const
