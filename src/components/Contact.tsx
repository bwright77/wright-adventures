import { useState } from 'react'
import { ArrowRight, Send } from 'lucide-react'
import { BRAND } from '../data/siteData'

export function Contact() {
  const [formData, setFormData] = useState({
    name: '',
    org: '',
    email: '',
    orgType: '',
    challenge: '',
    message: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // In production, wire this to a backend or form service (Formspree, Netlify Forms, etc.)
    const subject = encodeURIComponent(`Partnership inquiry from ${formData.name} — ${formData.org}`)
    const body = encodeURIComponent(
      `Name: ${formData.name}\nOrganization: ${formData.org}\nEmail: ${formData.email}\nOrg Type: ${formData.orgType}\nBiggest Challenge: ${formData.challenge}\n\nMessage:\n${formData.message}`
    )
    window.location.href = `mailto:${BRAND.email}?subject=${subject}&body=${body}`
    setSubmitted(true)
  }

  const inputClass =
    'w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-4 py-3 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-river/50 focus:ring-1 focus:ring-river/30 transition-all font-light'
  const selectClass =
    'w-full bg-white/[0.06] border border-white/[0.12] rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-river/50 focus:ring-1 focus:ring-river/30 transition-all font-light appearance-none'

  return (
    <section id="contact" className="py-24 px-6 lg:px-12 bg-gradient-to-br from-navy via-navy-800 to-navy-900 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-river/[0.04] rounded-full blur-[150px]" />
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-16 items-start">
          {/* Left — copy */}
          <div>
            <span className="section-label !text-white/35">Partner With Us</span>
            <h2 className="section-title !text-white text-balance">
              Let's talk about what your organization needs
            </h2>
            <p className="section-desc !text-white/55 mb-10">
              Whether you're a small conservation nonprofit looking for grant support, a youth
              program ready to scale, or a community group that needs technology — we'd like to hear
              from you.
            </p>

            <div className="space-y-4">
              <a
                href={`mailto:${BRAND.email}`}
                className="flex items-center gap-3 text-white/70 hover:text-river transition-colors group no-underline"
              >
                <span className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center group-hover:bg-river/20 transition-colors">
                  <Send size={16} className="text-river" />
                </span>
                <span className="text-sm">{BRAND.email}</span>
              </a>
              <a
                href={BRAND.phoneHref}
                className="flex items-center gap-3 text-white/70 hover:text-river transition-colors group no-underline"
              >
                <span className="w-10 h-10 rounded-lg bg-white/[0.06] flex items-center justify-center group-hover:bg-river/20 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-river">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <span className="text-sm">{BRAND.phone}</span>
              </a>
            </div>

            <p className="text-xs text-white/25 mt-8">
              {BRAND.location} — Serving organizations nationwide —{' '}
              <a href={BRAND.linkedin} className="text-river/60 hover:text-river no-underline">
                LinkedIn
              </a>
            </p>
          </div>

          {/* Right — form */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-8 backdrop-blur-sm">
            {submitted ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-trail/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4A7C59" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Thanks for reaching out</h3>
                <p className="text-sm text-white/50">Your email client should have opened with the details pre-filled. We'll be in touch soon.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-white/40 mb-4">
                  Tell us about your organization
                </h3>

                <div className="grid sm:grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="Your name"
                    required
                    className={inputClass}
                    value={formData.name}
                    onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Organization name"
                    required
                    className={inputClass}
                    value={formData.org}
                    onChange={e => setFormData(p => ({ ...p, org: e.target.value }))}
                  />
                </div>

                <input
                  type="email"
                  placeholder="Email address"
                  required
                  className={inputClass}
                  value={formData.email}
                  onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                />

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <select
                      className={selectClass}
                      value={formData.orgType}
                      onChange={e => setFormData(p => ({ ...p, orgType: e.target.value }))}
                    >
                      <option value="" className="bg-navy">Organization type</option>
                      <option value="conservation" className="bg-navy">Conservation nonprofit</option>
                      <option value="youth" className="bg-navy">Youth program</option>
                      <option value="watershed" className="bg-navy">Watershed / environmental</option>
                      <option value="community" className="bg-navy">Community organization</option>
                      <option value="other" className="bg-navy">Other</option>
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                  <div className="relative">
                    <select
                      className={selectClass}
                      value={formData.challenge}
                      onChange={e => setFormData(p => ({ ...p, challenge: e.target.value }))}
                    >
                      <option value="" className="bg-navy">Biggest challenge</option>
                      <option value="funding" className="bg-navy">Growing our funding</option>
                      <option value="programs" className="bg-navy">Building / scaling programs</option>
                      <option value="compliance" className="bg-navy">Navigating compliance</option>
                      <option value="technology" className="bg-navy">Accessing technology</option>
                      <option value="all" className="bg-navy">All of the above</option>
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9" /></svg>
                  </div>
                </div>

                <textarea
                  placeholder="Tell us a bit about what you're working on..."
                  rows={4}
                  className={`${inputClass} resize-none`}
                  value={formData.message}
                  onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                />

                <button type="submit" className="btn-primary w-full justify-center mt-2">
                  Start a conversation
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
