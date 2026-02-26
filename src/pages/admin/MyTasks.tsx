import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, isAfter } from 'date-fns'
import { CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
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

function TaskRow({ task, onComplete }: { task: Task; onComplete: (id: string) => void }) {
  const now = new Date()
  const isOverdue = task.due_date ? !isAfter(new Date(task.due_date), now) : false

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <button
        onClick={() => onComplete(task.id)}
        className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-river hover:bg-river/10 transition-colors mt-0.5 shrink-0"
        title="Mark complete"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-navy">{task.title}</p>
        {task.opportunity && (
          <Link
            to={`/admin/opportunities/${task.opportunity.id}`}
            className="text-xs text-gray-400 hover:text-river mt-0.5 capitalize transition-colors"
            onClick={e => e.stopPropagation()}
          >
            {task.opportunity.type_id} · {task.opportunity.name}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {task.due_date && (
          <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {format(new Date(task.due_date), 'MMM d')}
          </span>
        )}
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_STYLE[task.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>
    </div>
  )
}

function TaskGroup({ title, tasks, onComplete, accent }: {
  title: string
  tasks: Task[]
  onComplete: (id: string) => void
  accent: string
}) {
  return (
    <div>
      <h2 className={`text-xs font-semibold uppercase tracking-[0.08em] mb-3 ${accent}`}>{title}</h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {tasks.map(t => (
          <TaskRow key={t.id} task={t} onComplete={onComplete} />
        ))}
      </div>
    </div>
  )
}

export function MyTasks() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const now = new Date()

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ['my-tasks', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('tasks')
        .select('*, opportunity:opportunities(id, name, type_id)')
        .eq('assignee_id', profile.id)
        .neq('status', 'complete')
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.id,
  })

  const markComplete = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', taskId)
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
  })

  const overdue  = tasks.filter(t => t.due_date && !isAfter(new Date(t.due_date), now))
  const upcoming = tasks.filter(t => !t.due_date || isAfter(new Date(t.due_date), now))

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">My Tasks</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {tasks.length} open {tasks.length === 1 ? 'task' : 'tasks'}
          {overdue.length > 0 && ` · ${overdue.length} overdue`}
        </p>
      </div>

      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-xl border border-gray-200">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-trail" />
          <p className="text-sm font-medium text-navy">You're all caught up!</p>
          <p className="text-xs text-gray-400 mt-1">No open tasks assigned to you.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <TaskGroup
              title="Overdue"
              tasks={overdue}
              onComplete={id => markComplete.mutate(id)}
              accent="text-red-500"
            />
          )}
          {upcoming.length > 0 && (
            <TaskGroup
              title="Upcoming"
              tasks={upcoming}
              onComplete={id => markComplete.mutate(id)}
              accent="text-navy"
            />
          )}
        </div>
      )}
    </div>
  )
}
