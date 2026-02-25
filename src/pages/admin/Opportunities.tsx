import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { Opportunity, OpportunityTypeId } from '../../lib/types'

type TabFilter = 'all' | OpportunityTypeId

const STATUS_LABELS: Record<string, string> = {
  grant_identified:       'Identified',
  grant_evaluating:       'Evaluating',
  grant_preparing:        'Preparing',
  grant_submitted:        'Submitted',
  grant_under_review:     'Under Review',
  grant_awarded:          'Awarded',
  grant_declined:         'Declined',
  grant_withdrawn:        'Withdrawn',
  grant_archived:         'Archived',
  partnership_prospecting: 'Prospecting',
  partnership_outreach:    'Outreach',
  partnership_negotiating: 'Negotiating',
  partnership_formalizing: 'Formalizing',
  partnership_active:      'Active',
  partnership_on_hold:     'On Hold',
  partnership_completed:   'Completed',
  partnership_declined:    'Declined',
  partnership_archived:    'Archived',
}

const STATUS_COLORS: Record<string, string> = {
  grant_awarded:          'bg-trail-50 text-trail',
  grant_submitted:        'bg-river-50 text-river',
  grant_declined:         'bg-red-50 text-red-600',
  grant_withdrawn:        'bg-gray-100 text-gray-500',
  partnership_active:     'bg-trail-50 text-trail',
  partnership_completed:  'bg-gray-100 text-gray-500',
  partnership_declined:   'bg-red-50 text-red-600',
}

export function Opportunities() {
  const [tab, setTab]       = useState<TabFilter>('all')
  const [search, setSearch] = useState('')

  const { data: opportunities = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ['opportunities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const filtered = opportunities.filter(o => {
    if (tab !== 'all' && o.type_id !== tab) return false
    if (search && !o.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">Opportunities</h1>
          <p className="text-sm text-gray-400 mt-0.5">{opportunities.length} total</p>
        </div>
        <Link
          to="/admin/opportunities/new"
          className="flex items-center gap-2 bg-river hover:bg-river/90 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Opportunity
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['all', 'grant', 'partnership'] as TabFilter[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-navy'
              }`}
            >
              {t === 'all' ? 'All' : t === 'grant' ? 'Grants' : 'Partnerships'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search opportunities…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-xl border border-gray-200">
          <p className="text-gray-400 text-sm mb-2">
            {search ? 'No results match your search.' : 'No opportunities yet.'}
          </p>
          {!search && (
            <Link to="/admin/opportunities/new" className="text-sm text-river hover:underline">
              Create your first opportunity →
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden sm:table-cell">Type</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5">Status</th>
                <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-[0.07em] px-5 py-3.5 hidden md:table-cell">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(o => (
                <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link
                      to={`/admin/opportunities/${o.id}`}
                      className="text-sm font-medium text-navy hover:text-river transition-colors"
                    >
                      {o.name}
                    </Link>
                    {(o.funder ?? o.partner_org) && (
                      <p className="text-xs text-gray-400 mt-0.5">{o.funder ?? o.partner_org}</p>
                    )}
                  </td>
                  <td className="px-5 py-4 hidden sm:table-cell">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded capitalize ${
                      o.type_id === 'grant' ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
                    }`}>
                      {o.type_id}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${
                      STATUS_COLORS[o.status] ?? 'bg-gray-100 text-gray-600'
                    }`}>
                      {STATUS_LABELS[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500 hidden md:table-cell">
                    {o.primary_deadline
                      ? format(new Date(o.primary_deadline), 'MMM d, yyyy')
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
