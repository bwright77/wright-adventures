import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Profile, UserRole } from '../../lib/types'

const ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'admin',   label: 'Admin',   description: 'Full access, manage users' },
  { value: 'manager', label: 'Manager', description: 'Create and update opportunities' },
  { value: 'member',  label: 'Member',  description: 'View and complete tasks' },
  { value: 'viewer',  label: 'Viewer',  description: 'Read-only access' },
]

const ROLE_BADGE: Record<UserRole, string> = {
  admin:   'bg-earth/10 text-earth',
  manager: 'bg-river-50 text-river',
  member:  'bg-trail-50 text-trail',
  viewer:  'bg-gray-100 text-gray-500',
}

export function UserManagement() {
  const { profile: myProfile } = useAuth()
  const queryClient = useQueryClient()
  const [inviteEmail, setInviteEmail]     = useState('')
  const [inviteRole, setInviteRole]       = useState<UserRole>('member')
  const [inviteError, setInviteError]     = useState<string | null>(null)
  const [inviteSent, setInviteSent]       = useState(false)
  const [inviting, setInviting]           = useState(false)

  const { data: profiles = [], isLoading } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('*').order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const updateRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: UserRole }) => {
      const { error } = await supabase
        .from('profiles').update({ role, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['profiles'] }),
  })

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setInviteError(null)
    setInviting(true)
    try {
      // Invite via Supabase Auth (sends magic link email)
      const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail.trim())
      if (error) throw error
      setInviteSent(true)
      setInviteEmail('')
      // Note: role will be set to 'member' by default via the handle_new_user trigger.
      // If they need a different role, update it after they accept.
    } catch (err: unknown) {
      // Supabase client.auth.admin requires service role key — not available on the frontend.
      // Provide instructions instead.
      setInviteError(
        'User invites require the service role key, which can\'t be called from the browser. ' +
        'Add the user via the Supabase dashboard (Authentication → Users → Invite user), ' +
        'then set their role here.'
      )
    } finally {
      setInviting(false)
    }
  }

  const isAdmin = myProfile?.role === 'admin'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy">Team</h1>
        <p className="text-sm text-gray-400 mt-0.5">{profiles.length} {profiles.length === 1 ? 'member' : 'members'}</p>
      </div>

      {/* Invite form */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Invite team member</h2>

          {inviteSent ? (
            <div className="flex items-center gap-2 text-sm text-trail">
              <Mail size={14} />
              Invite sent! They'll receive a magic link to set their password.
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@wrightadventures.org"
                  required
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
                />
                <select
                  value={inviteRole}
                  onChange={e => setInviteRole(e.target.value as UserRole)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
                >
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-2 bg-river hover:bg-river/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <UserPlus size={14} />
                  {inviting ? 'Sending…' : 'Invite'}
                </button>
              </div>

              {inviteError && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 leading-relaxed">
                  {inviteError}
                </div>
              )}
            </form>
          )}
        </div>
      )}

      {/* User list */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Role</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden sm:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {profiles.map(p => {
                const isMe       = p.id === myProfile?.id
                const canEdit    = isAdmin && !isMe
                const initials   = p.full_name
                  ? p.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                  : '?'

                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-river/20 flex items-center justify-center text-river text-xs font-semibold shrink-0">
                          {initials}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-navy">
                            {p.full_name || <span className="text-gray-400 italic">No name</span>}
                            {isMe && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      {canEdit ? (
                        <select
                          value={p.role}
                          onChange={e => updateRole.mutate({ id: p.id, role: e.target.value as UserRole })}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-river/20 text-navy"
                        >
                          {ROLES.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded capitalize ${ROLE_BADGE[p.role] ?? 'bg-gray-100 text-gray-500'}`}>
                          {p.role}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400 hidden sm:table-cell">
                      {new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Role legend */}
      <div className="mt-6 grid sm:grid-cols-2 gap-3">
        {ROLES.map(r => (
          <div key={r.value} className="flex items-start gap-2.5 bg-white rounded-lg border border-gray-100 px-4 py-3">
            <span className={`mt-0.5 text-xs font-medium px-2 py-0.5 rounded capitalize shrink-0 ${ROLE_BADGE[r.value]}`}>
              {r.label}
            </span>
            <p className="text-xs text-gray-500">{r.description}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
