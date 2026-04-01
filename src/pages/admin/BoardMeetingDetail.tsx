import { useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, AlertTriangle, CheckCircle, Clock, Download,
  ChevronDown, ChevronRight, Loader2, Check
} from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { exportMinutesDocx } from '../../lib/boardMinutes/exportDocx'
import type { BoardMeeting, BoardMeetingExtractedData } from '../../lib/types'

// ── Helpers ───────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:        { label: 'Draft',        className: 'bg-gray-100 text-gray-600' },
  under_review: { label: 'Under Review', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  approved:     { label: 'Approved',     className: 'bg-green-50 text-green-700 border border-green-200' },
} as const

// Debounce helper for autosave
function useDebounce(fn: (...args: unknown[]) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback((...args: unknown[]) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => fn(...args), delay)
  }, [fn, delay])
}

// Collapsible section wrapper
function Section({ title, children, defaultOpen = true }: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-[0.07em]">{title}</span>
        {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start">
      <label className="text-xs text-gray-500 pt-2.5 leading-tight">{label}</label>
      <div>{children}</div>
    </div>
  )
}

function TextInput({
  value, onChange, placeholder, type = 'text',
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
    />
  )
}

function TextArea({
  value, onChange, rows = 3, placeholder,
}: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20 resize-y"
    />
  )
}

// For string-array fields (one item per line): keeps raw local state while typing
// so spaces and mid-line edits aren't destroyed by the trim+filter on every keystroke.
function ArrayTextArea({
  value, onChange, rows = 3, placeholder,
}: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string }) {
  const [raw, setRaw] = useState(() => value.join('\n'))

  // Sync in when the prop changes from outside (e.g. initial data load)
  const prevValue = useRef(value)
  if (prevValue.current !== value) {
    prevValue.current = value
    setRaw(value.join('\n'))
  }

  return (
    <textarea
      value={raw}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => onChange(raw.split('\n').map(s => s.trim()).filter(Boolean))}
      rows={rows}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20 resize-y"
    />
  )
}

// ── Component ─────────────────────────────────────────────────

export function BoardMeetingDetail() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [exportLoading, setExportLoading] = useState(false)

  // ── Load meeting ──────────────────────────────────────────────
  const { data: meeting, isLoading } = useQuery<BoardMeeting>({
    queryKey: ['board_meeting', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('board_meetings')
        .select(`
          *,
          approver:profiles!approved_by(id, full_name),
          creator:profiles!created_by(id, full_name)
        `)
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as BoardMeeting
    },
    refetchInterval: (query) => {
      const status = query.state.data?.extraction_status
      return status === 'processing' ? 3000 : false
    },
  })

  // Active data: edited_data takes precedence
  const activeData: BoardMeetingExtractedData | null = meeting?.edited_data ?? meeting?.extracted_data ?? null

  // ── Autosave edits ────────────────────────────────────────────
  const { mutate: saveEdits } = useMutation({
    mutationFn: async (patch: Partial<BoardMeetingExtractedData>) => {
      if (!id) return
      const current = activeData ?? ({} as BoardMeetingExtractedData)
      const merged = { ...current, ...patch }
      const { error } = await supabase
        .from('board_meetings')
        .update({ edited_data: merged })
        .eq('id', id)
      if (error) throw error
      return merged
    },
    onMutate: () => setSaveState('saving'),
    onSuccess: (merged) => {
      setSaveState('saved')
      queryClient.setQueryData(['board_meeting', id], (old: BoardMeeting | undefined) =>
        old ? { ...old, edited_data: merged } : old,
      )
      setTimeout(() => setSaveState('idle'), 2000)
    },
    onError: () => setSaveState('idle'),
  })

  const debouncedSave = useDebounce((patch: unknown) => saveEdits(patch as Partial<BoardMeetingExtractedData>), 2000)

  function updateField(patch: Partial<BoardMeetingExtractedData>) {
    if (!canEdit) return
    queryClient.setQueryData(['board_meeting', id], (old: BoardMeeting | undefined) => {
      if (!old) return old
      const current = old.edited_data ?? old.extracted_data ?? ({} as BoardMeetingExtractedData)
      return { ...old, edited_data: { ...current, ...patch } }
    })
    debouncedSave(patch)
  }

  // ── Dismiss AI flag ───────────────────────────────────────────
  function dismissFlag(flag: string) {
    if (!activeData || !profile?.id) return
    const dismissed = activeData.ai_flags_dismissed ?? []
    const updated: BoardMeetingExtractedData = {
      ...activeData,
      ai_flags_dismissed: [
        ...dismissed,
        { flag, dismissed_by: profile.id, dismissed_at: new Date().toISOString() },
      ],
    }
    saveEdits(updated)
  }

  // ── Status transitions ────────────────────────────────────────
  const { mutate: updateStatus, isPending: isUpdatingStatus } = useMutation({
    mutationFn: async (newStatus: BoardMeeting['status']) => {
      const patch: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'approved') {
        patch.approved_by = profile?.id
        patch.approved_at = new Date().toISOString()
      }
      const { error } = await supabase.from('board_meetings').update(patch).eq('id', id!)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board_meeting', id] }),
  })

  // ── DOCX export ───────────────────────────────────────────────
  async function handleExport() {
    if (!meeting || !activeData) return
    setExportLoading(true)
    try {
      const blob = await exportMinutesDocx(meeting, activeData)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const dateStr = meeting.meeting_date.replace(/-/g, '')
      a.href = url
      a.download = `board-minutes-${dateStr}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('DOCX export failed:', err)
    } finally {
      setExportLoading(false)
    }
  }

  // ── Loading & error states ────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-64" />
          <div className="h-40 bg-gray-100 rounded" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <p className="text-sm text-gray-400">Meeting not found.</p>
      </div>
    )
  }

  const statusCfg = STATUS_CONFIG[meeting.status] ?? STATUS_CONFIG.draft
  const isProcessing = meeting.extraction_status === 'processing'
  const hasFailed = meeting.extraction_status === 'failed'

  // Unacknowledged AI flags (blocks approval)
  const dismissedFlags = activeData?.ai_flags_dismissed?.map(d => d.flag) ?? []
  const unresolvedFlags = (activeData?.ai_flags ?? []).filter(f => !dismissedFlags.includes(f))
  const canApprove = canEdit && unresolvedFlags.length === 0 && activeData != null

  const meetingDateDisplay = meeting.meeting_date
    ? format(new Date(meeting.meeting_date + 'T12:00:00'), 'MMMM d, yyyy')
    : '—'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link to="/admin/board-meetings" className="p-1.5 text-gray-400 hover:text-navy rounded-lg hover:bg-gray-50 transition-colors shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-navy">{meetingDateDisplay}</h1>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.className}`}>
                {statusCfg.label}
              </span>
            </div>
            <p className="text-sm text-gray-400">{meeting.location}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Autosave indicator */}
          {saveState === 'saving' && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" /> Saving…
            </span>
          )}
          {saveState === 'saved' && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}

          {/* Export button */}
          {meeting.extraction_status === 'complete' && meeting.status === 'approved' && (
            <button
              onClick={handleExport}
              disabled={exportLoading}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-navy hover:bg-navy/90 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
            >
              {exportLoading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Export DOCX
            </button>
          )}
        </div>
      </div>

      {/* Extraction in progress */}
      {isProcessing && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-blue-50 border border-blue-100 rounded-xl">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Extracting minutes…</p>
            <p className="text-xs text-blue-600">Claude is parsing your transcript. This usually takes 15–30 seconds.</p>
          </div>
        </div>
      )}

      {/* Extraction failed */}
      {hasFailed && (
        <div className="flex items-start gap-3 p-4 mb-6 bg-red-50 border border-red-100 rounded-xl">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Extraction failed</p>
            {meeting.extraction_error && (
              <p className="text-xs text-red-600 mt-0.5">{meeting.extraction_error}</p>
            )}
          </div>
        </div>
      )}

      {/* AI Flags banner */}
      {activeData && unresolvedFlags.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              {unresolvedFlags.length} AI flag{unresolvedFlags.length !== 1 ? 's' : ''} require attention before approval
            </p>
          </div>
          <div className="divide-y divide-amber-100">
            {unresolvedFlags.map((flag, i) => (
              <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                <p className="text-sm text-amber-800 flex-1">{flag}</p>
                {canEdit && (
                  <button
                    onClick={() => dismissFlag(flag)}
                    className="text-xs font-medium text-amber-700 hover:text-amber-900 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors shrink-0 whitespace-nowrap"
                  >
                    Acknowledge & Dismiss
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dismissed flags (collapsed, informational) */}
      {activeData && dismissedFlags.length > 0 && (
        <div className="mb-4 text-xs text-gray-400">
          {dismissedFlags.length} flag{dismissedFlags.length !== 1 ? 's' : ''} acknowledged by reviewer.
        </div>
      )}

      {/* Editor — only shown when extraction is complete */}
      {activeData && !isProcessing && (
        <div className="space-y-3">
          {/* Meeting Info */}
          <Section title="Meeting Info">
            <FieldRow label="Date">
              <TextInput
                type="date"
                value={activeData.meeting_info?.date ?? ''}
                onChange={v => updateField({ meeting_info: { ...activeData.meeting_info, date: v } })}
              />
            </FieldRow>
            <FieldRow label="Start Time">
              <TextInput
                type="time"
                value={activeData.meeting_info?.start_time ?? ''}
                onChange={v => updateField({ meeting_info: { ...activeData.meeting_info, start_time: v } })}
              />
            </FieldRow>
            <FieldRow label="End Time">
              <TextInput
                type="time"
                value={activeData.meeting_info?.end_time ?? ''}
                onChange={v => updateField({ meeting_info: { ...activeData.meeting_info, end_time: v } })}
              />
            </FieldRow>
            <FieldRow label="Location">
              <TextInput
                value={activeData.meeting_info?.location ?? ''}
                onChange={v => updateField({ meeting_info: { ...activeData.meeting_info, location: v } })}
              />
            </FieldRow>
            <FieldRow label="Called to Order By">
              <TextInput
                value={activeData.meeting_info?.called_to_order_by ?? ''}
                onChange={v => updateField({ meeting_info: { ...activeData.meeting_info, called_to_order_by: v } })}
              />
            </FieldRow>
          </Section>

          {/* Attendance */}
          <Section title="Attendance">
            <FieldRow label="Directors Present">
              <ArrayTextArea
                value={activeData.attendance?.directors_present ?? []}
                onChange={v => updateField({
                  attendance: { ...activeData.attendance, directors_present: v },
                })}
                rows={3}
                placeholder="One name per line"
              />
            </FieldRow>
            <FieldRow label="Directors Absent">
              <ArrayTextArea
                value={activeData.attendance?.directors_absent ?? []}
                onChange={v => updateField({
                  attendance: { ...activeData.attendance, directors_absent: v },
                })}
                rows={2}
                placeholder="One name per line (leave blank if none)"
              />
            </FieldRow>
            <FieldRow label="Guests">
              <ArrayTextArea
                value={activeData.attendance?.guests ?? []}
                onChange={v => updateField({
                  attendance: { ...activeData.attendance, guests: v },
                })}
                rows={2}
                placeholder="One name per line (leave blank if none)"
              />
            </FieldRow>
            <FieldRow label="Quorum">
              <div className="flex items-center gap-4">
                {(['true', 'false', 'unknown'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="quorum"
                      value={opt}
                      checked={
                        opt === 'unknown'
                          ? activeData.attendance?.quorum_met === null
                          : String(activeData.attendance?.quorum_met) === opt
                      }
                      onChange={() => updateField({
                        attendance: {
                          ...activeData.attendance,
                          quorum_met: opt === 'unknown' ? null : opt === 'true',
                        },
                      })}
                      className="text-river"
                    />
                    <span className="text-gray-600 capitalize">{opt === 'true' ? 'Met' : opt === 'false' ? 'Not Met' : 'Unknown'}</span>
                  </label>
                ))}
              </div>
            </FieldRow>
          </Section>

          {/* Prior Minutes */}
          <Section title="Prior Minutes">
            <FieldRow label="Reviewed">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeData.prior_minutes?.reviewed ?? false}
                  onChange={e => updateField({
                    prior_minutes: { ...activeData.prior_minutes, reviewed: e.target.checked },
                  })}
                  className="rounded text-river"
                />
                <span className="text-sm text-gray-600">Prior minutes were reviewed</span>
              </label>
            </FieldRow>
            <FieldRow label="Approved">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeData.prior_minutes?.approved ?? false}
                  onChange={e => updateField({
                    prior_minutes: { ...activeData.prior_minutes, approved: e.target.checked },
                  })}
                  className="rounded text-river"
                />
                <span className="text-sm text-gray-600">Prior minutes were approved</span>
              </label>
            </FieldRow>
            <FieldRow label="Corrections">
              <TextArea
                value={activeData.prior_minutes?.corrections ?? ''}
                onChange={v => updateField({
                  prior_minutes: { ...activeData.prior_minutes, corrections: v || null },
                })}
                rows={2}
                placeholder="Note any corrections (leave blank if none)"
              />
            </FieldRow>
          </Section>

          {/* Reports */}
          {(activeData.reports ?? []).length > 0 && (
            <Section title="Reports">
              {activeData.reports.map((report, idx) => (
                <div key={idx} className="border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Title</label>
                      <TextInput
                        value={report.title}
                        onChange={v => {
                          const updated = [...activeData.reports]
                          updated[idx] = { ...updated[idx], title: v }
                          updateField({ reports: updated })
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Presenter</label>
                      <TextInput
                        value={report.presenter}
                        onChange={v => {
                          const updated = [...activeData.reports]
                          updated[idx] = { ...updated[idx], presenter: v }
                          updateField({ reports: updated })
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Summary</label>
                    <TextArea
                      value={report.summary}
                      onChange={v => {
                        const updated = [...activeData.reports]
                        updated[idx] = { ...updated[idx], summary: v }
                        updateField({ reports: updated })
                      }}
                      rows={3}
                    />
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Motions */}
          {(activeData.motions ?? []).length > 0 && (
            <Section title="Motions">
              {activeData.motions.map((motion, idx) => (
                <div key={idx} className="border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-navy bg-gray-100 px-2 py-0.5 rounded">{motion.id}</span>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Motion Text</label>
                    <TextArea
                      value={motion.description}
                      onChange={v => {
                        const updated = [...activeData.motions]
                        updated[idx] = { ...updated[idx], description: v }
                        updateField({ motions: updated })
                      }}
                      rows={2}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Moved By</label>
                      <TextInput
                        value={motion.moved_by}
                        onChange={v => {
                          const updated = [...activeData.motions]
                          updated[idx] = { ...updated[idx], moved_by: v }
                          updateField({ motions: updated })
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Seconded By</label>
                      <TextInput
                        value={motion.seconded_by}
                        onChange={v => {
                          const updated = [...activeData.motions]
                          updated[idx] = { ...updated[idx], seconded_by: v }
                          updateField({ motions: updated })
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Vote</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['yes', 'no', 'abstain'] as const).map(k => (
                        <div key={k}>
                          <label className="block text-xs text-gray-400 mb-1 capitalize">{k}</label>
                          <input
                            type="number"
                            min={0}
                            value={motion.vote[k] ?? ''}
                            onChange={e => {
                              const updated = [...activeData.motions]
                              updated[idx] = {
                                ...updated[idx],
                                vote: { ...updated[idx].vote, [k]: e.target.value === '' ? null : parseInt(e.target.value, 10) },
                              }
                              updateField({ motions: updated })
                            }}
                            placeholder="?"
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-river focus:ring-1 focus:ring-river/20"
                          />
                        </div>
                      ))}
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Result</label>
                        <TextInput
                          value={motion.vote.result}
                          onChange={v => {
                            const updated = [...activeData.motions]
                            updated[idx] = { ...updated[idx], vote: { ...updated[idx].vote, result: v } }
                            updateField({ motions: updated })
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* Action Items */}
          {(activeData.action_items ?? []).length > 0 && (
            <Section title="Action Items">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs text-gray-400 font-medium pb-2">Description</th>
                      <th className="text-left text-xs text-gray-400 font-medium pb-2 pl-3 w-36">Assigned To</th>
                      <th className="text-left text-xs text-gray-400 font-medium pb-2 pl-3 w-32">Due Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {activeData.action_items.map((item, idx) => (
                      <tr key={idx}>
                        <td className="py-2 pr-2">
                          <TextInput
                            value={item.description}
                            onChange={v => {
                              const updated = [...activeData.action_items]
                              updated[idx] = { ...updated[idx], description: v }
                              updateField({ action_items: updated })
                            }}
                          />
                        </td>
                        <td className="py-2 px-3">
                          <TextInput
                            value={item.assigned_to}
                            onChange={v => {
                              const updated = [...activeData.action_items]
                              updated[idx] = { ...updated[idx], assigned_to: v }
                              updateField({ action_items: updated })
                            }}
                          />
                        </td>
                        <td className="py-2 pl-3">
                          <TextInput
                            type="date"
                            value={item.due_date ?? ''}
                            onChange={v => {
                              const updated = [...activeData.action_items]
                              updated[idx] = { ...updated[idx], due_date: v || null }
                              updateField({ action_items: updated })
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Next Meeting */}
          <Section title="Next Meeting" defaultOpen={false}>
            <FieldRow label="Date">
              <TextInput
                type="date"
                value={activeData.next_meeting?.date ?? ''}
                onChange={v => updateField({ next_meeting: { ...activeData.next_meeting, date: v || null } })}
              />
            </FieldRow>
            <FieldRow label="Time">
              <TextInput
                type="time"
                value={activeData.next_meeting?.time ?? ''}
                onChange={v => updateField({ next_meeting: { ...activeData.next_meeting, time: v || null } })}
              />
            </FieldRow>
            <FieldRow label="Location">
              <TextInput
                value={activeData.next_meeting?.location ?? ''}
                onChange={v => updateField({ next_meeting: { ...activeData.next_meeting, location: v || null } })}
              />
            </FieldRow>
          </Section>

          {/* Adjournment */}
          <Section title="Adjournment" defaultOpen={false}>
            <FieldRow label="Adjourned At">
              <TextInput
                type="time"
                value={activeData.adjournment_time ?? ''}
                onChange={v => updateField({ adjournment_time: v || null })}
              />
            </FieldRow>
          </Section>
        </div>
      )}

      {/* Approval controls */}
      {canEdit && activeData && !isProcessing && (
        <div className="mt-6 p-4 bg-gray-50 rounded-xl border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-navy">
                {meeting.status === 'draft' ? 'Ready to submit for review?' : meeting.status === 'under_review' ? 'Approve these minutes?' : 'Minutes approved'}
              </p>
              {meeting.status === 'approved' && meeting.approver && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Approved by {(meeting.approver as unknown as { full_name: string }).full_name}
                  {meeting.approved_at ? ` on ${format(new Date(meeting.approved_at), 'MMM d, yyyy')}` : ''}
                </p>
              )}
              {unresolvedFlags.length > 0 && meeting.status !== 'approved' && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Resolve {unresolvedFlags.length} flag{unresolvedFlags.length !== 1 ? 's' : ''} above to enable approval
                </p>
              )}
            </div>

            {meeting.status === 'draft' && (
              <button
                onClick={() => updateStatus('under_review')}
                disabled={isUpdatingStatus}
                className="flex items-center gap-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                <Clock size={14} />
                Mark Under Review
              </button>
            )}

            {meeting.status === 'under_review' && (
              <button
                onClick={() => updateStatus('approved')}
                disabled={isUpdatingStatus || !canApprove}
                title={!canApprove ? 'Resolve all AI flags before approving' : undefined}
                className="flex items-center gap-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 px-4 py-2 rounded-lg transition-colors"
              >
                <CheckCircle size={14} />
                Approve Minutes
              </button>
            )}

            {meeting.status === 'approved' && (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle size={16} />
                <span>Approved</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
