import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail, Lock, AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { Logo } from '../components/Logo'

const schema = z.object({
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type FormValues = z.infer<typeof schema>

export function Login() {
  const { session, signInWithEmail, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [authError, setAuthError]       = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<FormValues>({ resolver: zodResolver(schema) })

  // Already signed in — go straight to admin
  if (session) return <Navigate to="/admin" replace />

  async function onSubmit(values: FormValues) {
    setAuthError(null)
    const { error } = await signInWithEmail(values.email, values.password)
    if (error) {
      setAuthError(error)
    } else {
      navigate('/admin')
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    setAuthError(null)
    const { error } = await signInWithGoogle()
    if (error) {
      setAuthError(error)
      setGoogleLoading(false)
    }
    // On success Supabase handles the redirect — no manual navigate needed
  }

  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-river/[0.06] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-1/3 h-1/3 bg-trail/[0.05] rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <Logo dark className="h-9 w-auto" />
        </div>

        <div className="bg-white/[0.04] border border-white/[0.1] rounded-2xl p-8 backdrop-blur-sm">
          <h1 className="text-xl font-semibold text-white mb-1">Sign in</h1>
          <p className="text-sm text-white/50 mb-7">Access the OMP workspace</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  {...register('email')}
                  type="email"
                  autoComplete="email"
                  placeholder="you@wrightadventures.org"
                  className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-river/60 focus:ring-1 focus:ring-river/30 transition-colors"
                />
              </div>
              {errors.email && (
                <p className="mt-1.5 text-xs text-red-400">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full bg-white/[0.06] border border-white/[0.12] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-white/25 focus:outline-none focus:border-river/60 focus:ring-1 focus:ring-river/30 transition-colors"
                />
              </div>
              {errors.password && (
                <p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Auth error */}
            {authError && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-400">{authError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-river hover:bg-river/90 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium text-sm py-2.5 rounded-lg transition-colors"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/[0.1]" />
            <span className="text-xs text-white/30">or</span>
            <div className="flex-1 h-px bg-white/[0.1]" />
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogle}
            disabled={googleLoading}
            className="flex items-center justify-center gap-3 w-full border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-60 disabled:cursor-not-allowed rounded-lg py-2.5 text-sm text-white/80 transition-colors"
          >
            {googleLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  )
}
