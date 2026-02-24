import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { Logo } from './Logo'
import { NAV_LINKS } from '../data/siteData'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const handleNavClick = () => setMobileOpen(false)

  return (
    <nav
      className={`fixed top-0 w-full z-50 px-6 lg:px-12 h-[72px] flex items-center justify-between transition-all duration-300 ${
        scrolled
          ? 'bg-white/95 backdrop-blur-xl shadow-[0_2px_20px_rgba(0,70,103,0.08)]'
          : 'bg-white/92 backdrop-blur-md'
      }`}
    >
      <a href="#" className="flex items-center gap-2.5 no-underline" onClick={handleNavClick}>
        <Logo className="w-10 h-10" />
        <div className="text-navy font-semibold text-lg tracking-wide">
          WRIGHT <span className="font-light text-river">Adventures</span>
        </div>
      </a>

      {/* Desktop nav */}
      <ul className="hidden md:flex items-center gap-8 list-none">
        {NAV_LINKS.map(link => (
          <li key={link.href}>
            <a
              href={link.href}
              className="text-gray-500 text-[0.92rem] font-medium hover:text-navy transition-colors relative group no-underline"
            >
              {link.label}
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-river transition-all duration-300 group-hover:w-full" />
            </a>
          </li>
        ))}
        <li>
          <a
            href="#contact"
            className="bg-navy text-white px-5 py-2.5 rounded-md text-[0.92rem] font-medium hover:bg-navy-dark hover:-translate-y-0.5 transition-all no-underline"
          >
            Partner With Us
          </a>
        </li>
      </ul>

      {/* Mobile toggle */}
      <button
        className="md:hidden p-2 -mr-2"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={24} className="text-navy" /> : <Menu size={24} className="text-navy" />}
      </button>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 top-[72px] bg-white z-40 px-6 py-8">
          <ul className="flex flex-col gap-6 list-none">
            {NAV_LINKS.map(link => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={handleNavClick}
                  className="text-navy text-lg font-medium no-underline"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="pt-2">
              <a
                href="#contact"
                onClick={handleNavClick}
                className="btn-primary justify-center w-full no-underline"
              >
                Partner With Us
              </a>
            </li>
          </ul>
        </div>
      )}
    </nav>
  )
}
