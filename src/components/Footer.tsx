import { BRAND } from '../data/siteData'
import { Logo } from './Logo'

const FOOTER_LINKS = [
  { label: 'Services', href: '#services' },
  { label: 'Our Work', href: '#work' },
  { label: 'Team', href: '#team' },
  { label: 'Contact', href: '#contact' },
]

export function Footer() {
  return (
    <footer className="bg-[#001825] py-8 px-6 lg:px-12">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <Logo dark className="h-8 w-auto" />
          <span className="text-white/50 text-sm font-light">
            &copy; {new Date().getFullYear()}
          </span>
        </div>

        <ul className="flex gap-6 list-none">
          {FOOTER_LINKS.map(link => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-white/40 text-sm no-underline hover:text-river transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="text-white/30 text-xs">{BRAND.location}</div>
      </div>
    </footer>
  )
}
