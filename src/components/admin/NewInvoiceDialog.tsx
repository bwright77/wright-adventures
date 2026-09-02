import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { todayLocal } from '../../lib/dates'

/**
 * An invoice for something the database does not already know how to bill —
 * an annual hosting fee, a deposit, a fixed-scope piece of work.
 *
 * The retainer and hourly generators derive their lines. This one takes them,
 * so it is the only path that can bill an amount with no schedule and no logged
 * time behind it.
 */

interface EngagementOption {
  id: string
  name: string
  billing_model: string
  payment_terms: string | null
  organizations: { name: string } | null
}

const TERM_LABEL: Record<string, string> = {
  due_on_signature: 'due on receipt',
  net_15: 'net 15',
  net_30: 'net 30',
  net_45: 'net 45',
}

export function NewInvoiceDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [engagementId, setEngagementId] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [issueDate, setIssueDate] = useState(todayLocal)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: engagements = [] } = useQuery<EngagementOption[]>({
    queryKey: ['engagements', 'invoiceable'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('engagements')
        .select('id, name, billing_model, payment_terms, organizations(name)')
        .neq('billing_model', 'non_billable')
        .order('created_at', { ascending: false })
      if (e) throw e
      return (data ?? []) as unknown as EngagementOption[]
    },
  })

  const selected = engagements.find(e => e.id === engagementId)
  const value = Number(amount)
  const valid = !!engagementId && description.trim().length > 0 && value > 0
    && (!periodStart) === (!periodEnd)

  const create = useMutation({
    mutationFn: async () => {
      const { data, error: e } = await supabase.rpc('create_manual_invoice', {
        p_engagement_id: engagementId,
        p_description: description.trim(),
        p_amount: value,
        p_issue_date: issueDate,
        p_period_start: periodStart || null,
        p_period_end: periodEnd || null,
        p_notes: null,
      })
      if (e) throw e
      return data as string
    },
    onSuccess: id => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] })
      queryClient.invalidateQueries({ queryKey: ['billable'] })
      onCreated(id)
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20'
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5'

  return (
    <div
      className="fixed inset-0 z-50 bg-navy/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md my-8 sm:my-0"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="New invoice"
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div>
            <h2 className="text-lg font-bold text-navy">New invoice</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              For a flat amount. Retainers and logged hours bill themselves.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-navy transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className={labelCls}>Engagement</label>
            <select value={engagementId} onChange={e => setEngagementId(e.target.value)} className={inputCls}>
              <option value="">Choose one…</option>
              {engagements.map(e => (
                <option key={e.id} value={e.id}>{e.organizations?.name} · {e.name}</option>
              ))}
            </select>
            {/* Contributed work is filtered out entirely — the database refuses
                it, and offering it here would only produce that error later. */}
            <p className="mt-1.5 text-xs text-gray-500">
              Contributed engagements are not listed; they are never invoiced.
            </p>
          </div>

          <div>
            <label className={labelCls}>What is this for?</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Website hosting and maintenance — 2026/27"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
                <input
                  value={amount}
                  onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="600"
                  inputMode="decimal"
                  className={`${inputCls} pl-6`}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Issue date</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Service period <span className="font-normal text-gray-500 normal-case">— optional</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className={inputCls} />
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className={inputCls} />
            </div>
            {(!periodStart) !== (!periodEnd) && (
              <p className="mt-1.5 text-xs text-earth">Give both ends, or neither.</p>
            )}
          </div>

          {selected && (
            <p className="text-xs text-gray-600">
              Payment terms {TERM_LABEL[selected.payment_terms ?? ''] ?? 'net 30'}, from the engagement.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-sm text-gray-600 hover:text-navy px-4 py-2.5 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { setError(null); create.mutate() }}
              disabled={!valid || create.isPending}
              className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
            >
              {create.isPending ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
