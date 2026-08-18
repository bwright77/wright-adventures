import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { NotificationPreference } from '../../lib/types'

// ── Notification preferences card ─────────────────────────────
function NotificationPreferencesCard() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const queryClient = useQueryClient()

  const { data: prefs, isLoading } = useQuery<NotificationPreference | null>({
    queryKey: ['notification_preferences'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { mutate: toggle } = useMutation({
    mutationFn: async (patch: Partial<NotificationPreference>) => {
      const userId = profile?.id
      if (!userId) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification_preferences'] }),
  })

  const defaultOn = true  // If no prefs row, all notifications are on by default

  const toggles: Array<{
    key: keyof NotificationPreference
    label: string
    description: string
    adminOnly?: boolean
  }> = [
    { key: 'deadline_7d', label: '7-day deadline reminder',  description: 'When a grant deadline is 7 days away' },
    { key: 'deadline_3d', label: '3-day deadline reminder',  description: 'When a grant deadline is 3 days away' },
    { key: 'deadline_1d', label: '1-day deadline reminder',  description: 'When a grant deadline is tomorrow' },
    { key: 'task_assigned', label: 'Task assigned', description: 'When a task is assigned to you' },
  ]

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-32" />
          <div className="h-10 bg-gray-100 rounded w-full" />
          <div className="h-10 bg-gray-100 rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="mt-0.5 p-1.5 bg-gray-50 rounded-lg">
          <Bell size={15} className="text-gray-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-navy mb-0.5">Email Notifications</h2>
          <p className="text-xs text-gray-400">Choose which events send you an email</p>
        </div>
      </div>

      <div className="space-y-1">
        {toggles.filter(t => !t.adminOnly || isAdmin).map(t => {
          const value = prefs ? (prefs[t.key] as boolean) : defaultOn
          return (
            <div key={t.key} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
              <div>
                <p className="text-sm text-navy">{t.label}</p>
                <p className="text-xs text-gray-400">{t.description}</p>
              </div>
              <button
                role="switch"
                aria-checked={value}
                onClick={() => toggle({ [t.key]: !value })}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-150 focus:outline-none ${
                  value ? 'bg-river' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 mt-0.5 ${
                    value ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-300 mt-4">
        Emails are sent to your account email address.
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export function Settings() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-navy mb-1">Settings</h1>
      <p className="text-sm text-gray-400 mb-8">Application configuration and usage</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            Notifications
          </h2>
          <NotificationPreferencesCard />
        </section>

      </div>
    </div>
  )
}
