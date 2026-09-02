import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toDateInput } from '../../lib/dates'
import type { Task, TaskStatus } from '../../lib/types'

/**
 * Add or correct a task, from wherever you are looking at one.
 *
 * The opportunity is optional. Tasks used to arrive only from stage templates,
 * so every one belonged to a pursuit; a task you write yourself often does not.
 * The picker lists open pursuits, plus whichever one this task already carries
 * even if it has since closed — otherwise editing a task would silently move it.
 */

const STATUSES: Array<{ id: TaskStatus; label: string }> = [
  { id: 'not_started', label: 'Not started' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'complete', label: 'Complete' },
]

export function TaskDialog({ task, onClose }: { task: Task | 'new'; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const existing = task === 'new' ? null : task

  const [title, setTitle] = useState(existing?.title ?? '')
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? 'not_started')
  const [dueDate, setDueDate] = useState(toDateInput(existing?.due_date))
  const [opportunityId, setOpportunityId] = useState<string>(existing?.opportunity_id ?? '')
  const [assigneeId, setAssigneeId] = useState<string>(existing?.assignee_id ?? profile?.id ?? '')
  const [error, setError] = useState<string | null>(null)

  const { data: opportunities = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['opportunities', 'open-for-tasks', existing?.opportunity_id],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('opportunities').select('id, name')
        .not('status', 'in', '("closed_won","closed_lost")')
        .order('name')
      if (e) throw e
      const open = data ?? []
      // Keep the current one selectable even after it closes.
      if (existing?.opportunity_id && !open.some(o => o.id === existing.opportunity_id)) {
        const { data: mine } = await supabase
          .from('opportunities').select('id, name').eq('id', existing.opportunity_id).single()
        if (mine) return [mine, ...open]
      }
      return open
    },
  })

  const { data: team = [] } = useQuery<Array<{ id: string; full_name: string }>>({
    queryKey: ['profiles', 'team'],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('profiles').select('id, full_name')
        .in('role', ['admin', 'manager', 'member']).order('full_name')
      if (e) throw e
      return data ?? []
    },
  })

  const titled = title.trim().length > 0

  const save = useMutation({
    mutationFn: async () => {
      if (!titled) return
      const patch = {
        title: title.trim(),
        status,
        due_date: dueDate || null,
        opportunity_id: opportunityId || null,
        assignee_id: assigneeId || null,
        updated_at: new Date().toISOString(),
      }
      const { error: e } = existing
        ? await supabase.from('tasks').update(patch).eq('id', existing.id)
        : await supabase.from('tasks').insert(patch)
      if (e) throw e
    },
    onSuccess: () => { invalidate(); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!existing) return
      const { error: e } = await supabase.from('tasks').delete().eq('id', existing.id)
      if (e) throw e
    },
    onSuccess: () => { invalidate(); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
    queryClient.invalidateQueries({ queryKey: ['opportunities'] })
  }

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
        aria-label={existing ? 'Edit task' : 'New task'}
      >
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <h2 className="text-lg font-bold text-navy">{existing ? 'Edit task' : 'New task'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className={labelCls}>Task</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Follow up with David Nickum"
              className={inputCls}
              onKeyDown={e => { if (e.key === 'Enter' && titled) save.mutate() }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Due</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className={inputCls}>
                {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Opportunity <span className="font-normal text-gray-500 normal-case">— optional</span>
            </label>
            <select value={opportunityId} onChange={e => setOpportunityId(e.target.value)} className={inputCls}>
              <option value="">Not tied to a pursuit</option>
              {opportunities.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          {team.length > 1 && (
            <div>
              <label className={labelCls}>Assigned to</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={inputCls}>
                <option value="">Nobody</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {existing ? (
              <button
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-red-600 px-2 py-2.5 transition-colors"
              >
                <Trash2 size={14} /> Delete
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="text-sm text-gray-600 hover:text-navy px-4 py-2.5 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { setError(null); save.mutate() }}
                disabled={!titled || save.isPending}
                className="text-sm font-medium bg-navy hover:bg-navy/90 disabled:opacity-40 text-white px-5 py-2.5 rounded-lg transition-colors"
              >
                {save.isPending ? 'Saving…' : existing ? 'Save' : 'Add task'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
