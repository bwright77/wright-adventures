# Wright Adventures — Nonprofit Advisory & Technology

Production-ready website for Wright Adventures, a nonprofit consultancy combining strategic consulting, AI-powered tools, and hands-on program design for conservation nonprofits, youth programs, and watershed groups.

## Tech Stack

- **React 18** + TypeScript
- **Vite** — build tooling
- **Tailwind CSS 3** — utility-first styling with custom brand tokens
- **React Router 6** — client-side routing (ready for multi-page expansion)
- **react-intersection-observer** — scroll-triggered animations
- **lucide-react** — icon system

## Brand Tokens (Tailwind)

| Token | Hex | Usage |
|-------|-----|-------|
| `navy` | `#004667` | Headers, primary CTAs, authority |
| `river` | `#009DD6` | Accents, links, energy |
| `earth` | `#B44B00` | Impact moments, stats, callouts |
| `trail` | `#4A7C59` | Trust sections, values, testimonials |

Font: **Jost** (loaded from Google Fonts)

## Development

```bash
npm install
npm run dev        # Start dev server at localhost:5173
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

## Deployment

### Vercel (Recommended — zero config)

1. Push this repo to GitHub
2. Go to vercel.com → Import Project → Select repo → Deploy
3. Custom domain setup takes ~2 minutes in the dashboard

### Netlify

1. Push to GitHub
2. netlify.com → Add new site → Import from Git
3. Build command: `npm run build` | Publish directory: `dist`
4. Add `public/_redirects` with `/*    /index.html   200` for SPA routing

### Manual / VPS

```bash
npm run build
# Upload dist/ contents to your web server
# Configure SPA fallback: serve index.html for all routes
```

## Project Structure

```
src/
├── components/        # UI components
│   ├── Navbar.tsx     # Fixed nav with scroll effect + mobile menu
│   ├── Hero.tsx       # Full-viewport hero with stats card
│   ├── ProofBar.tsx   # Social proof strip
│   ├── Services.tsx   # 4 JTBD-framed service cards
│   ├── Approach.tsx   # 3-step methodology
│   ├── CaseStudies.tsx # Lincoln Hills + GroundWork Denver
│   ├── Team.tsx       # Shane + Ben bios
│   ├── Values.tsx     # 6 core values grid
│   ├── Contact.tsx    # Contact form + info
│   ├── Footer.tsx
│   └── Logo.tsx       # SVG logo mark
├── data/
│   └── siteData.ts    # ALL site content lives here
├── hooks/
│   └── useFadeIn.ts   # Scroll animation hook
├── pages/
│   └── Home.tsx       # Home page composition
├── App.tsx
├── main.tsx
└── index.css
```

## Customization

All copy, stats, services, team bios, and values live in `src/data/siteData.ts`. Edit that one file to update any text without touching components.

Contact form currently opens mailto:. To add a backend, update `handleSubmit` in `Contact.tsx` to POST to Formspree, Netlify Forms, or a custom API.

## Next Steps

- [ ] Add real photography (hero, case studies, team headshots)
- [ ] Wire contact form to backend service
- [ ] Add blog / Field Notes section for SEO
- [ ] Add Confluence Colorado as third case study
- [ ] Set up analytics (Plausible or GA4)
- [ ] Create OG image and favicon from logo mark
