import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

/**
 * Closing a deal lost is three decisions, not one, and they belong in three
 * different places (ADR-012):
 *
 *   why we lost      → opportunity_details.lost_reason. About the deal.
 *   what they said   → an interaction on the ORGANISATION. The rejection email
 *                      outlives the opportunity; filing it against a dead record
 *                      buries it exactly when the next conversation needs it.
 *   nurture or drop  → organizations.relationship_tier. About the relationship,
 *                      which is a separate question from whether we won.
 *
 * GOBRP and CDI are the case for splitting them: both lost, opposite answers on
 * the relationship. GOBRP has a new development director worth pitching; CDI is
 * a cold application we should let go.
 *
 * This also unblocks a deadlock. The stage trigger refuses closed_lost without a
 * reason, but the reason field only rendered once the status was already
 * closed_lost — so the transition could never be made. The RPC sets the reason
 * and the status in one transaction, which is what it was built for.
 */

interface Props {
  opportunityId: string
  organizationId: string | null
  organizationName: string
  onClose: () => void
  onDone: () => void
}

type Fate = 'nurture' | 'drop'

export function CloseLostDialog({
  opportunityId, organizationId, organizationName, onClose, onDone,
}: Props) {
  const queryClient = useQueryClient()

  // Counted here rather than passed in: TaskPanel owns the task list, and
  // threading it up just to show one number is more coupling than it is worth.
  const { data: openTaskCount = 0 } = useQuery<number>({
    queryKey: ['tasks', opportunityId, 'open-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('tasks').select('*', { count: 'exact', head: true })
        .eq('opportunity_id', opportunityId).neq('status', 'complete')
      if (error) throw error
      return count ?? 0
    },
  })
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [fate, setFate] = useState<Fate>('nurture')
  const [revisitOn, setRevisitOn] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d.toISOString().slice(0, 10)
  })
  const [basis, setBasis] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = useMutation({
    mutationFn: async () => {
      // One transaction: the reason lands before the guard trigger reads it.
      const { error: rpcError } = await supabase.rpc('change_opportunity_stage', {
        p_opportunity_id: opportunityId,
        p_to_stage: 'closed_lost',
        p_note: note.trim() || null,
        p_lost_reason: reason.trim(),
      })
      if (rpcError) throw rpcError

      // Their words go on the organisation so they survive the dead deal.
      if (note.trim() && organizationId) {
        await supabase.from('interactions').insert({
          organization_id: organizationId,
          opportunity_id: opportunityId,
          interaction_type: 'email',
          direction: 'inbound',
          subject: 'Outcome — not selected',
          notes: note.trim(),
          occurred_at: new Date().toISOString(),
        })
      }

      // The relationship decision, which is not the same as the deal outcome.
      if (organizationId) {
        await supabase.from('organizations').update(
          fate === 'nurture'
            ? {
                relationship_tier: 'network',
                revisit_on: revisitOn || null,
                relationship_basis: basis.trim() || null,
                updated_at: new Date().toISOString(),
              }
            : { relationship_tier: 'none', revisit_on: null, updated_at: new Date().toISOString() },
        ).eq('id', organizationId)
      }

      // Unfinished work is retired; completed tasks stay as the record.
      await supabase.from('tasks').delete().eq('opportunity_id', opportunityId).neq('status', 'complete')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunity', opportunityId] })
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
      queryClient.invalidateQueries({ queryKey: ['organizations'] })
      queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 pb-4">
          <div>
            <h2 className="text-lg font-bold text-navy">Close as lost</h2>
            <p className="text-sm text-gray-600 mt-0.5">{organizationName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-navy transition-colors" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              Why did we lose it?
            </label>
            <input
              className={inputCls}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Chose a candidate with direct sector experience"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
              What they said <span className="font-normal text-gray-500 normal-case">— paste the email</span>
            </label>
            <textarea
              className={`${inputCls} h-28 resize-y`}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Their reply, in their words. Filed against the organisation so it is there next time you talk."
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              And the relationship?
            </span>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['nurture', 'Keep nurturing', 'Stays on the warm path and in discovery scoring.'],
                ['drop', 'Let it go', 'Removed from the warm path. The record stays.'],
              ] as const).map(([value, label, help]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFate(value)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    fate === value ? 'border-river bg-river-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className={`block text-sm font-semibold ${fate === value ? 'text-river-700' : 'text-navy'}`}>
                    {label}
                  </span>
                  <span className="block text-xs text-gray-600 mt-0.5 leading-snug">{help}</span>
                </button>
              ))}
            </div>
          </div>

          {fate === 'nurture' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Revisit on
                </label>
                <input type="date" className={inputCls} value={revisitOn} onChange={e => setRevisitOn(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  What is the opening?
                </label>
                <input
                  className={inputCls}
                  value={basis}
                  onChange={e => setBasis(e.target.value)}
                  placeholder="Pitch the new director on web + case for support"
                />
              </div>
            </div>
          )}

          {openTaskCount > 0 && (
            <p className="text-xs text-gray-600">
              {openTaskCount} unfinished task{openTaskCount === 1 ? '' : 's'} will be removed. Completed
              ones stay as the record of what was done.
            </p>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-sm text-gray-600 hover:text-navy px-4 py-2.5 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { setError(null); close.mutate() }}
              disabled={!reason.trim() || close.isPending}
              className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
            >
              {close.isPending ? 'Closing…' : 'Close as lost'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
