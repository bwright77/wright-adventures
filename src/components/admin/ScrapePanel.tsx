import { useState } from 'react'
import { Wand2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import type { ScrapeResult } from '../../lib/types'

// Fields the caller can receive and apply to the form
export interface ScrapedFields {
  name?: string
  description?: string
  partner_org?: string
  primary_contact?: string
  contact_email?: string
  estimated_value?: string
  tags?: string
  pain_points?: string
  tech_stack_notes?: string
  logo_url?: string
}

// Labels shown in the review panel
const FIELD_LABELS: { key: keyof ScrapedFields; label: string }[] = [
  { key: 'partner_org',        label: 'Organization name' },
  { key: 'name',               label: 'Opportunity name' },
  { key: 'description',        label: 'Description' },
  { key: 'primary_contact',    label: 'Primary contact' },
  { key: 'contact_email',      label: 'Contact email' },
  { key: 'estimated_value',    label: 'Estimated value' },
  { key: 'pain_points',        label: 'Key pain points' },
  { key: 'tech_stack_notes',   label: 'Technology systems' },
  { key: 'tags',               label: 'Tags' },
]

const CONFIDENCE_STYLES = {
  high:   'bg-green-50 text-green-800 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-gray-100 text-gray-600 border-gray-200',
}

interface ScrapePanelProps {
  sourceUrl: string
  onApply: (fields: ScrapedFields) => void
}

export function ScrapePanel({ sourceUrl, onApply }: ScrapePanelProps) {
  const { session } = useAuth()
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [result, setResult]           = useState<ScrapeResult | null>(null)
  const [open, setOpen]               = useState(false)
  const [selected, setSelected]       = useState<Set<keyof ScrapedFields>>(new Set())
  const [rawExcerptOpen, setRawExcerptOpen] = useState(false)

  const canScrape = sourceUrl.startsWith('http')

  async function scrape() {
    if (!canScrape || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    setOpen(false)

    try {
      const res = await fetch('/api/partnerships/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ url: sourceUrl }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Scrape failed')
        return
      }
      const scraped = json as ScrapeResult
      setResult(scraped)

      // Map to ScrapedFields and pre-select all non-empty fields
      const mapped = mapToScrapedFields(scraped)
      const preSelected = new Set(
        (Object.keys(mapped) as (keyof ScrapedFields)[])
          .filter(k => mapped[k] != null && mapped[k] !== '')
      )
      setSelected(preSelected)
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }

  function mapToScrapedFields(r: ScrapeResult): ScrapedFields {
    const e = r.extracted
    return {
      partner_org:      e.organization_name || undefined,
      name:             e.organization_name ? `${e.organization_name} — ${e.timeline_notes ? e.timeline_notes.slice(0, 60) : 'Partnership'}` : undefined,
      description:      e.project_description || undefined,
      primary_contact:  e.primary_contact_name
        ? `${e.primary_contact_name}${e.primary_contact_title ? ` (${e.primary_contact_title})` : ''}`
        : undefined,
      contact_email:    e.contact_email || undefined,
      estimated_value:  e.estimated_budget != null ? String(e.estimated_budget) : undefined,
      pain_points:      e.key_pain_points || undefined,
      tech_stack_notes: e.technology_systems_mentioned || undefined,
      tags:             e.tags?.join(', ') || undefined,
      logo_url:         e.logo_url || undefined,
    }
  }

  function applySelected() {
    if (!result) return
    const mapped = mapToScrapedFields(result)
    const toApply: ScrapedFields = {}
    for (const key of selected) {
      const val = mapped[key]
      if (val != null) (toApply as Record<string, unknown>)[key] = val
    }
    onApply(toApply)
    setOpen(false)
  }

  function toggleField(key: keyof ScrapedFields) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const mappedFields = result ? mapToScrapedFields(result) : null
  const availableFields = mappedFields
    ? FIELD_LABELS.filter(f => mappedFields[f.key] != null && mappedFields[f.key] !== '')
    : []

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={scrape}
          disabled={!canScrape || loading}
          title={!canScrape ? 'Enter a URL above first' : 'Extract fields from this page'}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white border-gray-200 text-gray-600 hover:border-trail/40 hover:text-trail hover:bg-trail/5"
        >
          {loading ? (
            <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Wand2 size={12} />
          )}
          {loading ? 'Fetching…' : 'Scrape & Fill'}
        </button>

        {result && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 text-xs text-trail hover:text-trail/80 transition-colors"
          >
            <ChevronDown size={13} />
            Show results
          </button>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {open && result && availableFields.length > 0 && (
        <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2">
              {result.extracted.logo_url && (
                <img
                  src={result.extracted.logo_url}
                  alt=""
                  className="w-6 h-6 rounded object-contain bg-white border border-gray-200 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <span className="text-xs font-semibold text-gray-700">Extracted fields</span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${CONFIDENCE_STYLES[result.confidence]}`}>
                {result.confidence} confidence
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <ChevronUp size={14} />
            </button>
          </div>

          {/* Field list */}
          <div className="divide-y divide-gray-50">
            {availableFields.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleField(key)}
                  className="mt-0.5 shrink-0 accent-trail"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide block">
                    {label}
                  </span>
                  <span className="text-sm text-navy line-clamp-2">{mappedFields![key]}</span>
                </div>
              </label>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-t border-gray-200">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSelected(new Set(availableFields.map(f => f.key)))}
                className="text-xs text-river hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
            </div>
            <button
              type="button"
              onClick={applySelected}
              disabled={selected.size === 0}
              className="text-xs font-medium bg-trail hover:bg-trail/90 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Apply {selected.size > 0 ? `${selected.size} field${selected.size > 1 ? 's' : ''}` : 'selected'}
            </button>
          </div>

          {/* Raw excerpt (collapsible) */}
          <div className="border-t border-gray-100">
            <button
              type="button"
              onClick={() => setRawExcerptOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <span>Source text preview</span>
              {rawExcerptOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {rawExcerptOpen && (
              <p className="px-4 pb-3 text-xs text-gray-500 font-mono leading-relaxed whitespace-pre-wrap">
                {result.raw_excerpt}
              </p>
            )}
          </div>
        </div>
      )}

      {open && result && availableFields.length === 0 && (
        <p className="mt-2 text-xs text-gray-500 italic">
          No fields could be extracted from this page. Try a different URL or enter details manually.
        </p>
      )}
    </div>
  )
}
