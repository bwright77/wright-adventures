import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, CheckCircle2, Circle, Loader2, Wand2 } from 'lucide-react'
import { format, isAfter, addDays } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, OpportunityTypeId } from '../../lib/types'

const TEMPLATE_IDS: Record<OpportunityTypeId, string> = {
  grant:       '00000000-0000-0000-0000-000000000001',
  partnership: '00000000-0000-0000-0000-000000000002',
}

interface TaskPanelProps {
  opportunityId:   string
  typeId:          OpportunityTypeId
  primaryDeadline: string | null
  ownerId:         string | null
}

function TaskRow({
  task,
  onToggle,
  toggling,
}: {
  task:     Task
  onToggle: (id: string, current: string) => void
  toggling: boolean
}) {
  const isComplete = task.status === 'complete'
  const isOverdue  = !isComplete && task.due_date
    ? !isAfter(new Date(task.due_date), new Date())
    : false

  return (
    <div className={`flex items-start gap-3 py-3 border-b border-gray-50 last:border-0 ${isComplete ? 'opacity-50' : ''}`}>
      <button
        onClick={() => onToggle(task.id, task.status)}
        disabled={toggling}
        className="mt-0.5 shrink-0 text-gray-300 hover:text-river transition-colors"
      >
        {isComplete
          ? <CheckCircle2 size={17} className="text-trail" />
          : <Circle size={17} />
        }
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isComplete ? 'line-through text-gray-400' : 'text-navy'}`}>
          {task.title}
        </p>
      </div>
      {task.due_date && (
        <span className={`text-xs shrink-0 ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
          {format(new Date(task.due_date), 'MMM d')}
        </span>
      )}
    </div>
  )
}

export function TaskPanel({ opportunityId, typeId, primaryDeadline, ownerId }: TaskPanelProps) {
  const { user }    = useAuth()
  const queryClient = useQueryClient()
  const [adding, setAdding]   = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue]   = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['tasks', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })

  const toggleTask = useMutation({
    mutationFn: async ({ id, current }: { id: string; current: string }) => {
      setTogglingId(id)
      const next = current === 'complete' ? 'not_started' : 'complete'
      const { error } = await supabase
        .from('tasks')
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      setTogglingId(null)
      void queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
    onError: () => setTogglingId(null),
  })

  const addTask = useMutation({
    mutationFn: async () => {
      if (!newTitle.trim()) return
      const maxOrder = tasks.length > 0 ? Math.max(...tasks.map(t => t.sort_order)) + 1 : 0
      const { error } = await supabase.from('tasks').insert({
        opportunity_id: opportunityId,
        title:          newTitle.trim(),
        due_date:       newDue || null,
        assignee_id:    ownerId ?? user?.id ?? null,
        sort_order:     maxOrder,
        status:         'not_started',
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNewTitle('')
      setNewDue('')
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
  })

  const generateTasks = useMutation({
    mutationFn: async () => {
      const templateId = TEMPLATE_IDS[typeId]
      const { data: items, error } = await supabase
        .from('task_template_items')
        .select('*')
        .eq('template_id', templateId)
        .order('sort_order')
      if (error) throw error
      if (!items?.length) return

      const base = primaryDeadline ? new Date(primaryDeadline) : new Date()
      const rows = items.map((item, i) => ({
        opportunity_id: opportunityId,
        title:          item.title,
        due_date:       addDays(base, item.days_offset).toISOString(),
        assignee_id:    ownerId ?? user?.id ?? null,
        sort_order:     i,
        status:         'not_started',
        days_offset:    item.days_offset,
      }))

      const { error: insertErr } = await supabase.from('tasks').insert(rows)
      if (insertErr) throw insertErr

      // Log it
      await supabase.from('activity_log').insert({
        opportunity_id: opportunityId,
        actor_id:       user?.id ?? null,
        action:         'tasks_generated',
        details:        { count: rows.length, template: templateId },
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['activity', opportunityId] })
    },
  })

  const open      = tasks.filter(t => t.status !== 'complete')
  const completed = tasks.filter(t => t.status === 'complete')

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em]">
          Tasks
          {open.length > 0 && (
            <span className="ml-2 text-navy normal-case tracking-normal font-medium">
              {open.length} open
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {tasks.length === 0 && (
            <button
              onClick={() => generateTasks.mutate()}
              disabled={generateTasks.isPending}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-navy border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 transition-colors"
            >
              {generateTasks.isPending
                ? <Loader2 size={12} className="animate-spin" />
                : <Wand2 size={12} />
              }
              <span className="hidden sm:inline">Generate from template</span>
              <span className="sm:hidden">From template</span>
            </button>
          )}
          <button
            onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1 text-xs text-river hover:text-river/80 transition-colors"
          >
            <Plus size={13} />
            Add task
          </button>
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTask.mutate(); if (e.key === 'Escape') setAdding(false) }}
            placeholder="Task title…"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={newDue}
              onChange={e => setNewDue(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
            />
            <div className="flex-1" />
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1"
            >
              Cancel
            </button>
            <button
              onClick={() => addTask.mutate()}
              disabled={!newTitle.trim() || addTask.isPending}
              className="text-xs bg-river hover:bg-river/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              {addTask.isPending ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {isLoading ? (
        <div className="py-6 flex justify-center">
          <div className="w-4 h-4 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">
          No tasks yet — add one above or generate from template.
        </p>
      ) : (
        <div>
          {open.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={(id, current) => toggleTask.mutate({ id, current })}
              toggling={togglingId === t.id}
            />
          ))}
          {completed.length > 0 && open.length > 0 && (
            <div className="border-t border-gray-100 mt-1 pt-1" />
          )}
          {completed.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={(id, current) => toggleTask.mutate({ id, current })}
              toggling={togglingId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
