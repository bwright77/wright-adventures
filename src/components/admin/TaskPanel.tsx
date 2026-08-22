import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, CheckCircle2, Circle, Loader2, Wand2, Pencil, Trash2, Check, X } from 'lucide-react'
import { format, isAfter, addDays } from 'date-fns'
import { parseLocalDate, toDateInput } from '../../lib/dates'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Task, Profile } from '../../lib/types'

// One kind of opportunity since ADR-012, so there is nothing to key on.
const DEFAULT_TEMPLATE_ID = '00000000-0000-0000-0000-000000000002'

interface TaskPanelProps {
  opportunityId:   string
  primaryDeadline: string | null
  ownerId:         string | null
}

export interface TaskPatch {
  title:       string
  due_date:    string | null
  assignee_id: string | null
}

function TaskRow({
  task,
  profiles,
  onToggle,
  onSave,
  onDelete,
  toggling,
}: {
  task:     Task
  profiles: Profile[]
  onToggle: (id: string, current: string) => void
  onSave:   (id: string, patch: TaskPatch) => void
  onDelete: (id: string) => void
  toggling: boolean
}) {
  const [editing, setEditing]   = useState(false)
  const [title, setTitle]       = useState(task.title)
  const [due, setDue]           = useState(toDateInput(task.due_date))
  const [assignee, setAssignee] = useState(task.assignee_id ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isComplete = task.status === 'complete'
  const isOverdue  = !isComplete && task.due_date
    ? !isAfter(new Date(task.due_date), new Date())
    : false

  function open() {
    // Re-seed from the task each time: a cancelled edit must not leak into the next.
    setTitle(task.title)
    setDue(toDateInput(task.due_date))
    setAssignee(task.assignee_id ?? '')
    setEditing(true)
  }

  function save() {
    const trimmed = title.trim()
    if (!trimmed) return                    // a task with no title is not a task
    setEditing(false)
    onSave(task.id, {
      title:       trimmed,
      due_date:    due || null,             // cleared input means no due date
      assignee_id: assignee || null,
    })
  }

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-navy focus:outline-none focus:border-river focus:ring-1 focus:ring-river/20'

  if (editing) {
    return (
      <div className="py-3 border-b border-gray-50 last:border-0 space-y-2">
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          className={inputCls}
          placeholder="Task title"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={due}
            onChange={e => setDue(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-navy focus:outline-none focus:border-river focus:ring-1 focus:ring-river/20"
          />
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-navy bg-white focus:outline-none focus:border-river focus:ring-1 focus:ring-river/20"
          >
            <option value="">Unassigned</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>

          <button
            onClick={save}
            disabled={!title.trim()}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-800 disabled:opacity-40 transition-colors"
          >
            <Check size={12} /> Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-navy transition-colors"
          >
            <X size={12} /> Cancel
          </button>

          {confirmDelete ? (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-red-700">Delete?</span>
              <button
                onClick={() => onDelete(task.id)}
                className="text-xs font-medium px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:text-navy transition-colors"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="ml-auto text-gray-300 hover:text-red-500 transition-colors"
              aria-label="Delete task"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const assigneeName = profiles.find(p => p.id === task.assignee_id)?.full_name

  return (
    <div className={`group flex items-start gap-3 py-3 border-b border-gray-50 last:border-0 ${isComplete ? 'opacity-50' : ''}`}>
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

      <button onClick={open} className="flex-1 min-w-0 text-left" title="Edit task">
        <p className={`text-sm ${isComplete ? 'line-through text-gray-400' : 'text-navy'}`}>
          {task.title}
        </p>
        {assigneeName && (
          <p className="text-xs text-gray-400 mt-0.5">{assigneeName}</p>
        )}
      </button>

      {task.due_date && (
        <button
          onClick={open}
          title="Edit task"
          className={`text-xs shrink-0 mt-0.5 ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}
        >
          {format(parseLocalDate(task.due_date), 'MMM d')}
        </button>
      )}

      {/* Always reachable, not hover-only: an undated task otherwise had no
          affordance at all, and hover-only controls are invisible on touch. */}
      <button
        onClick={open}
        aria-label={`Edit ${task.title}`}
        className="shrink-0 mt-0.5 text-gray-200 group-hover:text-gray-400 hover:!text-river transition-colors"
      >
        <Pencil size={13} />
      </button>
    </div>
  )
}

export function TaskPanel({ opportunityId, primaryDeadline, ownerId }: TaskPanelProps) {
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

  // Assignee options. Shared cache key with UserManagement.
  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('*').order('full_name')
      if (error) throw error
      return (data ?? []) as Profile[]
    },
    staleTime: 5 * 60 * 1000,
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

  const saveTask = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskPatch }) => {
      // due_date goes in as a bare YYYY-MM-DD. Postgres coerces it to UTC
      // midnight, which is the convention parseLocalDate expects — writing a
      // full ISO timestamp is what made stored values inconsistent to begin with.
      const { error } = await supabase
        .from('tasks')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
  })

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', opportunityId] })
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
    },
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
      const templateId = DEFAULT_TEMPLATE_ID

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
              profiles={profiles}
              onToggle={(id, current) => toggleTask.mutate({ id, current })}
              onSave={(id, patch) => saveTask.mutate({ id, patch })}
              onDelete={id => deleteTask.mutate(id)}
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
              profiles={profiles}
              onToggle={(id, current) => toggleTask.mutate({ id, current })}
              onSave={(id, patch) => saveTask.mutate({ id, patch })}
              onDelete={id => deleteTask.mutate(id)}
              toggling={togglingId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}
