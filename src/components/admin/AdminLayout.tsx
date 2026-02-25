import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Briefcase, CheckSquare, LogOut } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { Logo } from '../Logo'

const NAV_ITEMS = [
  { to: '/admin',               label: 'Dashboard',     icon: LayoutDashboard, end: true  },
  { to: '/admin/opportunities', label: 'Opportunities', icon: Briefcase,       end: false },
  { to: '/admin/tasks',         label: 'My Tasks',      icon: CheckSquare,     end: false },
]

export function AdminLayout() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = profile?.full_name || user?.email || ''
  const initials = profile?.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : (user?.email?.charAt(0).toUpperCase() ?? '?')

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-navy flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <Logo dark className="h-7 w-auto" />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
        </nav>

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

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
