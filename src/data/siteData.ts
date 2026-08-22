// ============================================================
// Wright Adventures — Brand Constants & Site Data
// ============================================================

export const BRAND = {
  name: 'Wright Adventures',
  tagline: 'Empowering Organizations to Do More',
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
    tag: 'Digital Legacy & Archive',
    tagColor: 'river' as const,
    title: 'PeopleForBikes — Better Bike Share Partnership',
    url: 'https://betterbikeshare.org',
    description: 'When the Better Bike Share Partnership reached its 2026 sunset after twelve years of shared-micromobility equity work, Wright Adventures preserved the entire legacy — permanently. We designed and built a custom retrospective site and a companion print Impact Report, then migrated a 500+ story archive with every original link intact, all backed by four years of fully-funded managed hosting so a decade of public knowledge stays live and findable.',
    metrics: [
      { value: '12 years', label: 'Of impact secured' },
      { value: 'Web + print', label: 'Custom impact story built' },
    ],
  },
  {
    tag: 'Brand & Technology',
    tagColor: 'earth' as const,
    title: 'Confluence Colorado',
    url: 'https://www.confluenceco.org',
    description: 'Built Confluence Colorado\'s brand identity from the ground up — logo, visual language, and messaging — then designed and launched their website. We continue to manage their technology infrastructure and lead their grant management strategy, serving as an ongoing strategic and operational partner.',
    metrics: [
      { value: 'Full build', label: 'Brand, web & tech' },
      { value: 'Ongoing', label: 'Strategy & tech partner' },
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
  {
    tag: 'Brand & Digital Advocacy',
    tagColor: 'trail' as const,
    title: 'River Sisters · Hermanas del Río',
    description: 'Wright Adventures partners with the River Sisters Congreso — a bilingual, community-led coalition advancing recognition for Colorado\'s rivers — to build a brand identity, a bilingual website, and a sustainable social and advocacy engine. We produce and build; the coalition\'s cultural leadership holds every approval, and the community artist owns the mark.',
    metrics: [
      { value: 'Community-led', label: 'Artist-owned identity' },
      { value: 'Bilingual', label: 'Brand, web & advocacy' },
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
    tag: 'Partnership & Capacity',
    tagColor: 'earth' as const,
    title: 'Kady Youth Sheep Camp',
    url: 'https://kadysheepcamp.org',
    description: 'Wright Adventures provides the administrative, financial, and digital backbone for the Kady Youth Sheep Camp, a Diné youth apprenticeship in Teec Nos Pos, Arizona that teaches traditional lifeways through raising Navajo-Churro sheep. We serve as fiscal partner, build and steward the program\'s web presence, and support its fundraising and grant strategy — with the community holding final say over how its story is told.',
    metrics: [
      { value: 'Fiscal partner', label: 'Administrative backbone' },
      { value: 'Brand & web', label: 'Digital presence built' },
    ],
  },
  {
    tag: 'Conservation & Community',
    tagColor: 'river' as const,
    title: 'Groundwork Denver',
    description: 'Built grant strategy and program design capacity for urban youth conservation and community health programs, creating pathways that connect young people to environmental careers and community leadership.',
    metrics: [
      { value: '$3M+', label: 'Total funds raised' },
      { value: 'Youth & watershed', label: 'Dual-impact programs' },
    ],
  },
] as const

export const TEAM = [
  {
    name: 'Shane Wright',
    role: 'Founder & Executive Director',
    icon: 'Network',
    gradient: 'from-trail to-[#5A9C6D]',
    bio: '20+ years leading youth development, conservation, and community programs across Colorado. Former director at Groundwork Denver and architect of the Lincoln Hills Cares pathways initiative. Deep relationships across the nonprofit, foundation, and government sectors.',
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

// ── On the air ────────────────────────────────────────────────
// The logo is served from our own public/ folder. It CANNOT be hot-linked:
// kgnu.org returns 200 to curl but refuses the browser's cross-site request, so
// the image silently fails to decode. Hosting it ourselves also means we don't
// depend on their CDN layout or use their bandwidth.
export const RADIO = {
  station:    'KGNU Community Radio',
  stationDial: '88.5 FM Boulder · 1390 AM Denver',
  show:       'Metro',
  host:       'Miss Beverly Grant',
  airedOn:    'August 12, 2026',
  episodeUrl: 'https://kgnu.org/shows/metro/08-12-2026/',
  logo:       '/kgnu-logo.png',
  logoAlt:    'KGNU Community Radio',

  // Verbatim from the broadcast. These sit between "Who We Are" and "Our
  // Values" and carry the weight of both: the first explains where the work
  // comes from, the second what we actually sell, the third why we keep
  // checking ourselves. Lightly elided, never reworded — they are quotes.
  // One each. Verbatim, lightly elided, never reworded.
  //
  // Both are commitments, not musings — they sit under the value cards to back
  // them up, so a hedge would undercut the thing it is meant to support. Ben's
  // is Empowerment: what the engagement actually buys. Shane's is Equity: who
  // the work is for.
  //
  // Cut, deliberately: Shane's "are we part of the problem or part of the
  // solution?" On air that lands because Miss Bev answers it immediately —
  // "I'm gonna say you're part of the solution." Lifted out of the exchange the
  // answer disappears and only the doubt survives. Also cut, his river origin
  // story: lovely, but biography, and Team already carries it.
  quotes: [
    {
      speaker: 'Ben',
      text: 'How can I free you up to do the work you want to be doing? We want to get in, have something built that you know how to use, that you own, that you’re going to keep using well beyond our relationship.',
    },
    {
      speaker: 'Shane',
      text: 'We use nature as the tool for youth development — urban gardens, the river corridors. Everything has a community-based lens. It’s bringing resources to communities that haven’t necessarily had as much.',
    },
  ],

  // Two words carry further than the sentence they arrived in. She named it
  // listening to Ben, so she is named — and it is said plainly that the phrase
  // is hers rather than ours.
  pullQuote:   'Responsible technology.',
  quoteSource: 'Miss Beverly Grant’s words, not ours — the name she gave it, mid-conversation.',
} as const
