import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Ban, CheckCircle2, Plus, Download } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { parseLocalDate } from '../../lib/dates'
import { formatHours } from '../../lib/retainer'

/**
 * Invoices (ADR-010 Phase 1).
 *
 * Creating one calls a database function rather than writing rows from here: an
 * invoice is assembled from a header, its lines, and the linking of whatever it
 * bills, and a half-written invoice holding a consumed number is worse than
 * none. The two generators mirror the two billing models — a retainer bills the
 * next scheduled period in advance, hourly work bills unbilled entries in
 * arrears.
 *
 * Sent invoices are immutable, enforced by a trigger. Corrections are made by
 * voiding and reissuing, which releases whatever the invoice held so it can be
 * billed again.
 */

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:   { label: 'Draft',   cls: 'bg-gray-100 text-gray-700' },
  sent:    { label: 'Sent',    cls: 'bg-navy-50 text-navy' },
  partial: { label: 'Partial', cls: 'bg-earth-50 text-earth' },
  paid:    { label: 'Paid',    cls: 'bg-trail-50 text-trail-700' },
  overdue: { label: 'Overdue', cls: 'bg-red-50 text-red-700' },
  void:    { label: 'Void',    cls: 'bg-gray-100 text-gray-600 line-through' },
}

interface InvoiceRow {
  id: string
  invoice_number: string
  issue_date: string
  due_date: string
  period_start: string | null
  period_end: string | null
  subtotal: number | string
  total: number | string
  amount_paid: number | string
  status: string
  notes: string | null
  sent_at: string | null
  engagements: { name: string; organizations: { name: string } | null } | null
}

const money = (v: number | string | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export function Invoices() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['invoices'] })
    queryClient.invalidateQueries({ queryKey: ['billable'] })
    queryClient.invalidateQueries({ queryKey: ['retainer_periods'] })
    queryClient.invalidateQueries({ queryKey: ['time_entries'] })
  }

  const { data: invoices = [], isLoading } = useQuery<InvoiceRow[]>({
    queryKey: ['invoices'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('invoices')
        .select('*, engagements(name, organizations(name))')
        .order('issue_date', { ascending: false })
        .order('invoice_number', { ascending: false })
      if (e) throw e
      return (data ?? []) as unknown as InvoiceRow[]
    },
  })

  // What could be billed right now: a retainer with a period still scheduled,
  // or non-retainer work with unbilled tracked hours and a rate to price them.
  const { data: billable = [] } = useQuery<any[]>({
    queryKey: ['billable'],
    queryFn: async () => {
      const { data: engs } = await supabase
        .from('engagements')
        .select('id, name, billing_model, contract_rate, organizations(name)')
        .neq('billing_model', 'non_billable')
      const { data: periods } = await supabase
        .from('retainer_periods').select('engagement_id, period_start, fee').eq('status', 'scheduled')
      const { data: entries } = await supabase
        .from('time_entries').select('engagement_id, minutes')
        .is('invoice_id', null).eq('billable', true).eq('is_estimate', false)

      return (engs ?? []).flatMap((e: any) => {
        if (e.billing_model === 'retainer') {
          const next = (periods ?? []).filter(p => p.engagement_id === e.id)
            .sort((a, b) => a.period_start.localeCompare(b.period_start))[0]
          return next ? [{ ...e, kind: 'retainer', detail: `${format(parseLocalDate(next.period_start), 'MMMM yyyy')} retainer`, amount: Number(next.fee) }] : []
        }
        const mins = (entries ?? []).filter(t => t.engagement_id === e.id).reduce((s, t) => s + t.minutes, 0)
        if (!mins) return []
        const rate = Number(e.contract_rate ?? 0)
        return [{
          ...e, kind: 'time',
          detail: `${formatHours(mins)} h unbilled`,
          amount: rate ? (mins / 60) * rate : null,
          blocked: rate ? null : 'no rate recorded on this engagement',
        }]
      })
    },
  })

  const { data: lines = [] } = useQuery<any[]>({
    queryKey: ['invoice_lines', selectedId],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('invoice_line_items').select('*').eq('invoice_id', selectedId!).order('sort_order')
      if (e) throw e
      return data ?? []
    },
    enabled: !!selectedId,
  })

  const selected = invoices.find(i => i.id === selectedId) ?? invoices[0] ?? null

  const [pdfBusy, setPdfBusy] = useState(false)

  /**
   * Loaded on demand. @react-pdf/renderer carries a font engine and a PDF
   * writer; there is no reason for that to sit in the bundle every admin page
   * pays for when it is wanted a few times a month.
   */
  const downloadPdf = async () => {
    if (!selected) return
    setPdfBusy(true)
    try {
      const { downloadInvoicePdf } = await import('../../lib/invoicePdf')
      await downloadInvoicePdf({
        ...selected,
        engagementName: selected.engagements?.name ?? '',
        organizationName: selected.engagements?.organizations?.name ?? '',
        lines,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  const createInvoice = useMutation({
    mutationFn: async (b: any) => {
      const fn = b.kind === 'retainer' ? 'generate_retainer_invoice' : 'generate_time_invoice'
      const { data, error: e } = await supabase.rpc(fn, { p_engagement_id: b.id })
      if (e) throw e
      return data as string
    },
    onSuccess: id => { setSelectedId(id); setError(null); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string; total?: number | string }) => {
      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === 'sent') patch.sent_at = new Date().toISOString()
      if (status === 'paid') { patch.paid_at = new Date().toISOString(); patch.amount_paid = selected?.total ?? 0 }
      const { error: e } = await supabase.from('invoices').update(patch).eq('id', id)
      if (e) throw e
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  const voidIt = useMutation({
    mutationFn: async (id: string) => {
      const { error: e } = await supabase.rpc('void_invoice', { p_invoice_id: id, p_reason: null })
      if (e) throw e
    },
    onSuccess: () => { setError(null); invalidate() },
    onError: (e: Error) => setError(e.message),
  })

  const outstanding = invoices
    .filter(i => i.status === 'sent' || i.status === 'partial' || i.status === 'overdue')
    .reduce((s, i) => s + Number(i.total) - Number(i.amount_paid), 0)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Invoices</h1>
          <p className="text-sm text-gray-600 mt-0.5">
            {invoices.filter(i => i.status !== 'void').length} issued
          </p>
        </div>
        <div>
          <p className="text-3xl font-bold text-navy tabular-nums leading-none">{money(outstanding)}</p>
          <p className="text-xs text-gray-600 mt-1">outstanding</p>
        </div>
      </div>

      {billable.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Ready to bill</h2>
          <ul className="divide-y divide-gray-100">
            {billable.map(b => (
              <li key={b.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy truncate">{b.organizations?.name}</p>
                  <p className="text-xs text-gray-600 truncate">
                    {b.detail}
                    {b.blocked && <span className="text-earth"> — {b.blocked}</span>}
                  </p>
                </div>
                <span className="text-sm font-semibold text-navy tabular-nums shrink-0">
                  {b.amount == null ? '—' : money(b.amount)}
                </span>
                <button
                  onClick={() => createInvoice.mutate(b)}
                  disabled={!!b.blocked || createInvoice.isPending}
                  className="flex items-center gap-1.5 text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition-colors shrink-0"
                >
                  <Plus size={14} />
                  Create invoice
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="mb-6 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="grid lg:grid-cols-[1fr_1fr] gap-6 items-start">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <p className="p-6 text-sm text-gray-500">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No invoices yet.</p>
          ) : (
            <ul>
              {invoices.map(i => (
                <li key={i.id}>
                  <button
                    onClick={() => setSelectedId(i.id)}
                    className={`w-full text-left flex items-center gap-3 px-5 py-3.5 border-t border-gray-100 first:border-t-0 transition-colors ${
                      selected?.id === i.id ? 'bg-navy-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-navy">{i.invoice_number}</p>
                      <p className="text-xs text-gray-600 truncate">{i.engagements?.organizations?.name}</p>
                    </div>
                    <span className="text-sm font-semibold text-navy tabular-nums shrink-0">{money(i.total)}</span>
                    <span className={`text-[0.7rem] font-medium px-2 py-0.5 rounded shrink-0 ${STATUS[i.status]?.cls}`}>
                      {STATUS[i.status]?.label ?? i.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-lg font-bold text-navy">{selected.invoice_number}</h2>
                <p className="text-sm text-gray-600">{selected.engagements?.organizations?.name}</p>
                <p className="text-xs text-gray-600">{selected.engagements?.name}</p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded shrink-0 ${STATUS[selected.status]?.cls}`}>
                {STATUS[selected.status]?.label ?? selected.status}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-y-2 text-sm mb-5">
              <dt className="text-gray-600">Issued</dt>
              <dd className="text-navy text-right">{format(parseLocalDate(selected.issue_date), 'd MMM yyyy')}</dd>
              <dt className="text-gray-600">Due</dt>
              <dd className="text-navy text-right">{format(parseLocalDate(selected.due_date), 'd MMM yyyy')}</dd>
              {selected.period_start && (
                <>
                  <dt className="text-gray-600">Covers</dt>
                  <dd className="text-navy text-right">
                    {format(parseLocalDate(selected.period_start), 'd MMM')} – {format(parseLocalDate(selected.period_end!), 'd MMM')}
                  </dd>
                </>
              )}
            </dl>

            <ul className="border-t border-gray-100">
              {lines.map(l => (
                <li key={l.id} className="flex items-start gap-3 py-2.5 border-b border-gray-100">
                  <span className="text-sm text-gray-600 flex-1 min-w-0">{l.description}</span>
                  <span className="text-sm text-navy tabular-nums shrink-0">{money(l.amount)}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-baseline justify-between pt-4">
              <span className="text-sm font-semibold text-navy">Total</span>
              <span className="text-xl font-bold text-navy tabular-nums">{money(selected.total)}</span>
            </div>

            {selected.notes && <p className="mt-4 text-xs text-gray-600 whitespace-pre-line">{selected.notes}</p>}

            <div className="flex flex-wrap items-center gap-2 mt-6 pt-5 border-t border-gray-100">
              {/* Available in every state — a paid or voided invoice still has to be
                  retrievable as the document that was actually sent. */}
              <button
                onClick={() => downloadPdf()}
                disabled={pdfBusy}
                className="flex items-center gap-2 text-sm font-medium border border-gray-300 text-navy hover:border-navy px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <Download size={14} /> {pdfBusy ? 'Preparing…' : 'Download PDF'}
              </button>

              {selected.status !== 'void' && selected.status !== 'paid' && (
                <>
                  {selected.status === 'draft' && (
                    <button
                      onClick={() => setStatus.mutate({ id: selected.id, status: 'sent' })}
                      className="flex items-center gap-2 text-sm font-medium bg-navy hover:bg-navy/90 text-white px-4 py-2.5 rounded-lg transition-colors"
                    >
                      <Send size={14} /> Mark as sent
                    </button>
                  )}
                  {selected.status !== 'draft' && (
                    <button
                      onClick={() => setStatus.mutate({ id: selected.id, status: 'paid' })}
                      className="flex items-center gap-2 text-sm font-medium bg-trail hover:bg-trail-700 text-white px-4 py-2.5 rounded-lg transition-colors"
                    >
                      <CheckCircle2 size={14} /> Mark paid
                    </button>
                  )}
                  <button
                    onClick={() => voidIt.mutate(selected.id)}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-red-600 px-3 py-2.5 transition-colors ml-auto"
                    title="Releases whatever this invoice billed so it can be billed again"
                  >
                    <Ban size={14} /> Void
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
