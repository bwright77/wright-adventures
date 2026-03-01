import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, ClipboardList, CheckCircle, Clock, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { BoardMeeting } from '../../lib/types'

// ── Helpers ───────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:        { label: 'Draft',        className: 'bg-gray-100 text-gray-600' },
  under_review: { label: 'Under Review', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  approved:     { label: 'Approved',     className: 'bg-green-50 text-green-700 border border-green-200' },
} as const

function StatusBadge({ status }: { status: BoardMeeting['status'] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {status === 'approved' && <CheckCircle size={11} />}
      {status === 'under_review' && <Clock size={11} />}
      {cfg.label}
    </span>
  )
}

// ── Component ─────────────────────────────────────────────────

export function BoardMeetings() {
  const { data: meetings = [], isLoading } = useQuery<BoardMeeting[]>({
    queryKey: ['board_meetings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board_meetings')
        .select(`
          id, meeting_date, location, status, extraction_status,
          created_at, created_by, approved_by, approved_at,
          creator:profiles!created_by(id, full_name),
          approver:profiles!approved_by(id, full_name)
        `)
        .order('meeting_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BoardMeeting[]
    },
  })

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-48" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy mb-1">Board Minutes</h1>
          <p className="text-sm text-gray-400">
            Confluence Colorado — monthly board meeting records
          </p>
        </div>
        <Link
          to="/admin/board-meetings/new"
          className="flex items-center gap-2 text-sm font-medium text-white bg-navy hover:bg-navy/90 px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Meeting
        </Link>
      </div>

      {meetings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <ClipboardList size={24} className="text-gray-300" />
          </div>
          <h3 className="text-sm font-semibold text-navy mb-2">No meetings yet</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">
            Upload a Google Meet transcript to generate your first set of board minutes.
          </p>
          <Link
            to="/admin/board-meetings/new"
            className="inline-flex items-center gap-2 text-sm font-medium text-white bg-navy hover:bg-navy/90 px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            Add First Meeting
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] px-6 py-3">
                  Meeting Date
                </th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] px-4 py-3">
                  Location
                </th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] px-4 py-3">
                  Status
                </th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] px-4 py-3">
                  Approved By
                </th>
                <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-[0.07em] px-4 py-3">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {meetings.map(meeting => (
                <tr
                  key={meeting.id}
                  className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <Link
                      to={`/admin/board-meetings/${meeting.id}`}
                      className="flex items-center gap-2 group"
                    >
                      <FileText size={15} className="text-gray-300 group-hover:text-river transition-colors shrink-0" />
                      <span className="text-sm font-medium text-navy group-hover:text-river transition-colors">
                        {format(new Date(meeting.meeting_date + 'T12:00:00'), 'MMMM d, yyyy')}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {meeting.location}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={meeting.status} />
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {meeting.approver
                      ? (meeting.approver as unknown as { full_name: string }).full_name
                      : '—'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-400">
                    {format(new Date(meeting.created_at), 'MMM d, yyyy')}
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
