import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface UsageData {
  period_start: string
  monthly_limit: number
  tokens_used: number
  percent_used: number
  updated_at: string | null
}

// ── Token budget card ─────────────────────────────────────────
function TokenBudgetCard() {
  const { session } = useAuth()
  const queryClient  = useQueryClient()
  const [editLimit, setEditLimit] = useState('')
  const [editing, setEditing]     = useState(false)

  const { data: usage, isLoading } = useQuery<UsageData>({
    queryKey: ['ai_usage'],
    queryFn: async () => {
      const res = await fetch('/api/ai/usage', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (!res.ok) throw new Error('Failed to fetch usage')
      return res.json()
    },
    refetchInterval: 60_000, // refresh every minute
  })

  const { mutate: updateLimit, isPending } = useMutation({
    mutationFn: async (newLimit: number) => {
      // Directly update via Supabase (admin has RLS access)
      const { error } = await supabase
        .from('token_budgets')
        .update({ monthly_limit: newLimit, updated_at: new Date().toISOString() })
        .eq('current_period_start', usage?.period_start ?? '')
      if (error) throw error
    },
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['ai_usage'] })
    },
  })

  function handleSaveLimit() {
    const val = parseInt(editLimit, 10)
    if (isNaN(val) || val < 1000) return
    updateLimit(val)
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-100 rounded w-32" />
          <div className="h-8 bg-gray-100 rounded w-full" />
          <div className="h-4 bg-gray-100 rounded w-48" />
        </div>
      </div>
    )
  }

  if (!usage) return null

  const pct          = usage.percent_used
  const barColor     = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-400' : 'bg-river'
  const formattedPct = Math.min(pct, 100)
  const approxCost   = ((usage.tokens_used / 1_000_000) * 3).toFixed(2)  // ~$3/M tokens Sonnet

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-navy mb-1">Monthly Token Budget</h2>
          <p className="text-xs text-gray-400">
            Period: {usage.period_start}
            {usage.updated_at && (
              <> · Updated {new Date(usage.updated_at).toLocaleTimeString()}</>
            )}
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['ai_usage'] })}
          className="p-1.5 text-gray-400 hover:text-navy rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>{usage.tokens_used.toLocaleString()} tokens used</span>
          <span>{usage.monthly_limit.toLocaleString()} limit</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${formattedPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className={`font-medium ${pct >= 90 ? 'text-red-600' : pct >= 70 ? 'text-amber-600' : 'text-gray-600'}`}>
            {pct}% consumed
          </span>
          <span className="text-gray-400">≈ ${approxCost} this month</span>
        </div>
      </div>

      {/* High-usage warning */}
      {pct >= 80 && (
        <div className="flex items-start gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            Token usage is above 80%. Consider increasing the limit or asking team to start new chat sessions.
          </span>
        </div>
      )}

      {/* Edit limit */}
      <div className="border-t border-gray-100 pt-4">
        {editing ? (
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={editLimit}
              onChange={e => setEditLimit(e.target.value)}
              placeholder="e.g. 1000000"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
            />
            <button
              onClick={handleSaveLimit}
              disabled={isPending}
              className="text-sm bg-river text-white px-4 py-2 rounded-lg hover:bg-river/90 disabled:opacity-50 transition-colors"
            >
              {isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-sm text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setEditLimit(String(usage.monthly_limit)); setEditing(true) }}
            className="text-xs text-river hover:underline"
          >
            Change monthly limit
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export function Settings() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-navy mb-1">Settings</h1>
      <p className="text-sm text-gray-400 mb-8">Application configuration and usage</p>

      {isAdmin ? (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            AI Usage
          </h2>
          <TokenBudgetCard />
        </section>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <p className="text-sm text-gray-500">
            Settings are only visible to administrators.
          </p>
        </div>
      )}
    </div>
  )
}
