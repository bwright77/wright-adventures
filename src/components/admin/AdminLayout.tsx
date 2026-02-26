import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, CheckSquare, Users, LogOut, Settings, Menu, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { Logo } from '../Logo'

const NAV_ITEMS = [
  { to: '/admin',               label: 'Dashboard',     icon: LayoutDashboard, end: true,  adminOnly: false },
  { to: '/admin/opportunities', label: 'Opportunities', icon: Briefcase,       end: false, adminOnly: false },
  { to: '/admin/tasks',         label: 'My Tasks',      icon: CheckSquare,     end: false, adminOnly: false },
  { to: '/admin/team',          label: 'Team',          icon: Users,           end: false, adminOnly: false },
  { to: '/admin/settings',      label: 'Settings',      icon: Settings,        end: false, adminOnly: true  },
]

export function AdminLayout() {
  const { user, profile, signOut } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Poll latest discovery run for the cron status badge (admin only)
  const { data: latestRun } = useQuery({
    queryKey: ['discovery_runs', 'latest'],
    queryFn: async () => {
      const { data } = await supabase
        .from('discovery_runs')
        .select('status, started_at')
        .order('started_at', { ascending: false })
        .limit(1)
        .single()
      return data
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const cronStatus = !latestRun ? null
    : latestRun.status === 'running' ? 'running'
    : latestRun.status === 'failed'  ? 'failed'
    : null

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name || user?.email || ''
  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (user?.email?.charAt(0).toUpperCase() ?? '?')

  const visibleItems = NAV_ITEMS.filter(item => !item.adminOnly || isAdmin)

  function NavItems({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <>
        {visibleItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-river/20 text-river'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </>
    )
  }

  return (
    <div className="flex flex-col lg:flex-row h-[100dvh] bg-gray-50">

      {/* ── Mobile top bar ──────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-3 bg-navy shrink-0 lg:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-1.5 text-white/60 hover:text-white rounded-lg transition-colors"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <Logo dark className="h-6 w-auto" />
        <div className="w-8 h-8 rounded-full bg-river/30 flex items-center justify-center text-white text-xs font-semibold">
          {initials}
        </div>
      </header>

      {/* ── Mobile drawer backdrop ──────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar — desktop always visible, mobile slide-in ───── */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-navy flex flex-col shrink-0 transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:static lg:w-60 lg:translate-x-0 lg:flex
      `}>
        {/* Logo + close button */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <Logo dark className="h-7 w-auto" />
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 text-white/40 hover:text-white rounded-lg transition-colors lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          <NavItems onNavigate={() => setSidebarOpen(false)} />
        </nav>

        {/* Cron status badge — admin only, only when running or failed */}
        {isAdmin && cronStatus && (
          <div className="px-3 pb-2">
            <button
              onClick={() => { navigate('/admin/settings'); setSidebarOpen(false) }}
              className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs transition-colors ${
                cronStatus === 'running'
                  ? 'bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
                  : 'bg-red-500/10 text-red-300 hover:bg-red-500/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                cronStatus === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-red-400'
              }`} />
              {cronStatus === 'running' ? 'Discovery running…' : 'Discovery run failed'}
            </button>
          </div>
        )}

        {/* User */}
        <div className="px-3 py-4 border-t border-white/10 space-y-1">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-river/30 flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">{displayName}</p>
              {profile?.role && (
                <p className="text-[0.7rem] text-white/40 capitalize">{profile.role}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
