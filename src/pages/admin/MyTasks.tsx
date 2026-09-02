import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isAfter } from 'date-fns'
import { parseLocalDate } from '../../lib/dates'
import { CheckCircle2, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { TaskDialog } from '../../components/admin/TaskDialog'
import type { Task } from '../../lib/types'

const STATUS_STYLE: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-river-50 text-river',
  complete:    'bg-trail-50 text-trail',
  blocked:     'bg-red-50 text-red-600',
}
const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  complete:    'Complete',
  blocked:     'Blocked',
}

function TaskRow({ task, onComplete, onEdit }: {
  task: Task
  onComplete: (id: string) => void
  onEdit: (task: Task) => void
}) {
  const now = new Date()
  const isOverdue = task.due_date ? !isAfter(new Date(task.due_date), now) : false
  const done = task.status === 'complete'

  return (
    <div className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50/70 transition-colors">
      <button
        onClick={() => onComplete(task.id)}
        className={`w-5 h-5 rounded-full border-2 transition-colors mt-0.5 shrink-0 ${
          done
            ? 'bg-trail border-trail'
            : 'border-gray-300 hover:border-river hover:bg-river/10'
        }`}
        title={done ? 'Mark not started' : 'Mark complete'}
      />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => onEdit(task)}
          className="text-sm font-medium text-navy text-left hover:text-river transition-colors"
        >
          {task.title}
        </button>
        {task.opportunity && (
          <Link
            to={`/admin/opportunities/${task.opportunity.id}`}
            className="block text-xs text-gray-400 hover:text-river mt-0.5 transition-colors"
            onClick={e => e.stopPropagation()}
          >
            {task.opportunity.name}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {task.due_date && (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {format(parseLocalDate(task.due_date), 'MMM d')}
          </span>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_STYLE[task.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>
    </div>
  )
}

function TaskGroup({ title, tasks, onComplete, onEdit, accent }: {
  title: string
  tasks: Task[]
  onComplete: (id: string) => void
  onEdit: (task: Task) => void
  accent: string
}) {
  return (
    <div>
      <h2 className={`text-xs font-semibold uppercase tracking-[0.08em] mb-3 ${accent}`}>{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {tasks.map(t => (
          <TaskRow key={t.id} task={t} onComplete={onComplete} onEdit={onEdit} />
        ))}
      </div>
    </div>
  )
}

export function MyTasks() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [showDone, setShowDone] = useState(false)

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['my-tasks', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('tasks')
        .select('*, opportunity:opportunities(id, name)')
        .eq('assignee_id', profile.id)
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  // Toggles, so a mis-click is undone the same way it was made.
  const markComplete = useMutation({
    mutationFn: async (taskId: string) => {
      const current = tasks.find(t => t.id === taskId)
      const { error } = await supabase
        .from('tasks')
        .update({
          status: current?.status === 'complete' ? 'not_started' : 'complete',
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
  })

  const open     = tasks.filter(t => t.status !== 'complete')
  const done     = tasks.filter(t => t.status === 'complete')
  const overdue  = open.filter(t => t.due_date && !isAfter(new Date(t.due_date), now))
  const upcoming = open.filter(t => !t.due_date || isAfter(new Date(t.due_date), now))

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy">My Tasks</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {open.length} open {open.length === 1 ? 'task' : 'tasks'}
            {overdue.length > 0 && ` · ${overdue.length} overdue`}
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 text-sm font-medium bg-navy hover:bg-navy/90 text-white px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={14} /> New task
        </button>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {open.length === 0 && (
            <div className="py-20 text-center bg-white rounded-xl border border-gray-200">
              <CheckCircle2 size={32} className="mx-auto mb-3 text-trail" />
              <p className="text-sm font-medium text-navy">You're all caught up!</p>
              <p className="text-xs text-gray-400 mt-1">No open tasks assigned to you.</p>
            </div>
          )}
          {overdue.length > 0 && (
            <TaskGroup
              title="Overdue"
              tasks={overdue}
              onComplete={id => markComplete.mutate(id)}
              onEdit={setEditing}
              accent="text-red-500"
            />
          )}
          {upcoming.length > 0 && (
            <TaskGroup
              title="Upcoming"
              tasks={upcoming}
              onComplete={id => markComplete.mutate(id)}
              onEdit={setEditing}
              accent="text-navy"
            />
          )}
          {done.length > 0 && (
            showDone ? (
              <TaskGroup
                title={`Completed · ${done.length}`}
                tasks={done}
                onComplete={id => markComplete.mutate(id)}
                onEdit={setEditing}
                accent="text-gray-400"
              />
            ) : (
              <button
                onClick={() => setShowDone(true)}
                className="text-xs text-gray-500 hover:text-navy transition-colors"
              >
                Show {done.length} completed
              </button>
            )
          )}
        </div>
      )}

      {editing && <TaskDialog task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
