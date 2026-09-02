import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { parseDuration, parseBillable, formatHours } from '../../lib/retainer'

/**
 * Correcting a logged entry.
 *
 * Entries were insert-or-delete only, which is how every seeded estimate ended
 * up dated 1 January — a placeholder nobody could move. Deleting and re-logging
 * is not the same thing: it loses the entry's identity, and on a retainer it
 * churns the ledger.
 *
 * Invoiced time does not open. The database refuses it too — this only saves
 * the round trip and says why.
 */

interface EditableEntry {
  id: string
  entry_date: string
  minutes: number
  description: string
  billable: boolean
  is_estimate: boolean
  locked?: boolean
  user_id: string | null
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

export function EntryEditDialog({
  entry, team, onClose,
}: {
  entry: EditableEntry
  team: Array<{ id: string; full_name: string }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [entryDate, setEntryDate] = useState(entry.entry_date)
  const [duration, setDuration] = useState(formatHours(entry.minutes))
  const [description, setDescription] = useState(entry.description ?? '')
  const [billable, setBillable] = useState(entry.billable)
  const [userId, setUserId] = useState<string | null>(entry.user_id)
  const [error, setError] = useState<string | null>(null)

  const rawMinutes = parseDuration(duration)
  const minutes = parseBillable(duration)
  const roundedUp = rawMinutes != null && minutes != null && minutes !== rawMinutes
  const described = description.trim().length > 0
  const locked = !!entry.locked

  const save = useMutation({
    mutationFn: async () => {
      if (!minutes || !described) return
      const { error: e } = await supabase.from('time_entries').update({
        entry_date: entryDate,
        minutes,
        description: description.trim(),
        billable,
        user_id: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', entry.id)
      if (e) throw e
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time_entries'] })
      queryClient.invalidateQueries({ queryKey: ['retainer_ledger'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20 disabled:bg-gray-50 disabled:text-gray-500'

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
        aria-label="Edit time entry"
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div>
            <h2 className="text-lg font-bold text-navy">Edit entry</h2>
            {entry.is_estimate && (
              <p className="text-xs text-earth mt-0.5">Estimated — recalled, not tracked</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-navy transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {locked && (
          <p className="mx-6 mb-4 flex gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 leading-relaxed">
            <Lock size={14} className="shrink-0 mt-0.5" />
            This time is on an issued invoice. Void the invoice to release it — an invoice that
            has gone out should not quietly change.
          </p>
        )}

        <div className="px-6 pb-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Date</label>
              <input
                type="date" value={entryDate} disabled={locked}
                onChange={e => setEntryDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">How long?</label>
              <input
                value={duration} disabled={locked}
                onChange={e => setDuration(e.target.value)}
                placeholder="2.5"
                className={inputCls}
              />
            </div>
          </div>
          {duration && minutes == null && (
            <p className="-mt-2 text-xs text-red-600">Not a duration I can read.</p>
          )}
          {roundedUp && (
            <p className="-mt-2 text-xs text-gray-600">
              {rawMinutes} min bills as <span className="font-medium text-navy">{formatHours(minutes!)} h</span>
            </p>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">What did you do?</label>
            <input
              value={description} disabled={locked}
              onChange={e => setDescription(e.target.value)}
              className={inputCls}
            />
          </div>

          {team.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Who</label>
              <div className="flex flex-wrap gap-2">
                {team.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={locked}
                    onClick={() => setUserId(m.id)}
                    aria-pressed={userId === m.id}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50 ${
                      userId === m.id
                        ? 'bg-navy border-navy text-white'
                        : 'bg-white border-gray-300 text-gray-600 hover:border-navy hover:text-navy'
                    }`}
                  >
                    {firstName(m.full_name)}
                  </button>
                ))}
              </div>
              {userId == null && (
                <p className="mt-1.5 text-xs text-gray-500">Unattributed — one of the seeded totals.</p>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox" checked={billable} disabled={locked}
              onChange={e => setBillable(e.target.checked)} className="rounded"
            />
            Billable
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="text-sm text-gray-600 hover:text-navy px-4 py-2.5 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { setError(null); save.mutate() }}
              disabled={locked || !minutes || !described || save.isPending}
              className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
