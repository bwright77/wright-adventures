import { Outlet, Routes, Route } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { Footer } from './components/Footer'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { AdminLayout } from './components/admin/AdminLayout'
import { ProtectedRoute } from './components/admin/ProtectedRoute'
import { Dashboard } from './pages/admin/Dashboard'
import { Opportunities } from './pages/admin/Opportunities'
import { OpportunityDetail } from './pages/admin/OpportunityDetail'
import { MyTasks } from './pages/admin/MyTasks'

function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      {/* Public marketing site */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
      </Route>

      {/* Auth */}
      <Route path="/login" element={<Login />} />

      {/* Admin portal — protected, separate layout */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="opportunities" element={<Opportunities />} />
        <Route path="opportunities/:id" element={<OpportunityDetail />} />
        <Route path="tasks" element={<MyTasks />} />
      </Route>
    </Routes>
  )
}
