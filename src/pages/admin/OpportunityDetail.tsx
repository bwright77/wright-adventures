import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Calendar, Tag, ChevronDown, Pencil, UserCircle } from 'lucide-react'
import { format, formatDistanceToNow, addDays } from 'date-fns'
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { TaskPanel } from '../../components/admin/TaskPanel'
import type { Opportunity, ActivityEntry, Profile } from '../../lib/types'

// ── Pipeline config ───────────────────────────────────────────
const GRANT_STAGES = [
  { id: 'grant_identified',   label: 'Identified'   },
  { id: 'grant_evaluating',   label: 'Evaluating'   },
  { id: 'grant_preparing',    label: 'Preparing'    },
  { id: 'grant_submitted',    label: 'Submitted'    },
  { id: 'grant_under_review', label: 'Under Review' },
  { id: 'grant_awarded',      label: 'Awarded'      },
]
const GRANT_TERMINAL = [
  { id: 'grant_declined',  label: 'Declined'  },
  { id: 'grant_withdrawn', label: 'Withdrawn' },
  { id: 'grant_archived',  label: 'Archived'  },
]
const PARTNERSHIP_STAGES = [
  { id: 'partnership_prospecting', label: 'Prospecting' },
  { id: 'partnership_outreach',    label: 'Outreach'    },
  { id: 'partnership_negotiating', label: 'Negotiating' },
  { id: 'partnership_formalizing', label: 'Formalizing' },
  { id: 'partnership_active',      label: 'Active'      },
]
const PARTNERSHIP_TERMINAL = [
  { id: 'partnership_on_hold',   label: 'On Hold'   },
  { id: 'partnership_completed', label: 'Completed' },
  { id: 'partnership_declined',  label: 'Declined'  },
  { id: 'partnership_archived',  label: 'Archived'  },
]

// Statuses that auto-generate tasks when first entered
const AUTO_GEN_STAGES = new Set(['grant_preparing', 'partnership_formalizing'])
const TEMPLATE_IDS: Record<string, string> = {
  grant:       '00000000-0000-0000-0000-000000000001',
  partnership: '00000000-0000-0000-0000-000000000002',
}

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  [...GRANT_STAGES, ...GRANT_TERMINAL, ...PARTNERSHIP_STAGES, ...PARTNERSHIP_TERMINAL]
    .map(s => [s.id, s.label])
)

// ── Sub-components ────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-[0.07em] sm:w-40 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-navy">{value}</span>
    </div>
  )
}

function PipelineStepper({
  stages, terminal, currentStatus, color, onSelect, isPending,
}: {
  stages: { id: string; label: string }[]
  terminal: { id: string; label: string }[]
  currentStatus: string
  color: 'river' | 'trail'
  onSelect: (id: string) => void
  isPending: boolean
}) {
  const [open, setOpen] = useState(false)
  const stageIdx   = stages.findIndex(s => s.id === currentStatus)
  const isTerminal = stageIdx === -1
  const terminalItem = isTerminal ? terminal.find(t => t.id === currentStatus) : null

  const activeClass  = color === 'river' ? 'bg-river text-white border-river' : 'bg-trail text-white border-trail'
  const pastClass    = color === 'river' ? 'bg-river/15 text-river border-river/20' : 'bg-trail/15 text-trail border-trail/20'
  const futureClass  = 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {stages.map((stage, i) => {
        const isCurrent = stage.id === currentStatus
        const isPast    = !isTerminal && i < stageIdx
        return (
          <button
            key={stage.id}
            onClick={() => !isCurrent && !isPending && onSelect(stage.id)}
            disabled={isCurrent || isPending}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors disabled:cursor-default ${
              isCurrent ? activeClass : isPast ? pastClass : futureClass
            }`}
          >
            {stage.label}
          </button>
        )
      })}
      <span className="text-gray-300 text-xs select-none">·</span>
      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          disabled={isPending}
          className={`flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
            isTerminal ? 'bg-gray-100 text-gray-700 border-gray-300' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600'
          }`}
        >
          {isTerminal ? (terminalItem?.label ?? 'Terminal') : 'Close out…'}
          <ChevronDown size={10} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[130px]">
              {terminal.map(t => (
                <button
                  key={t.id}
                  onClick={() => { onSelect(t.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${
                    t.id === currentStatus ? 'text-gray-800 font-medium' : 'text-gray-600'
                  }`}
                >
                  {t.label}{t.id === currentStatus ? ' ✓' : ''}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {isPending && <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />}
    </div>
  )
}

function ActivityLog({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-gray-400 italic">No activity yet.</p>

  function describe(entry: ActivityEntry): string {
    if (entry.action === 'status_changed') {
      const d = entry.details as { from?: string; to?: string } | null
      return `Status: ${STATUS_LABELS[d?.from ?? ''] ?? d?.from ?? '—'} → ${STATUS_LABELS[d?.to ?? ''] ?? d?.to ?? '—'}`
    }
    if (entry.action === 'tasks_generated') {
      const d = entry.details as { count?: number } | null
      return `${d?.count ?? ''} tasks generated from template`
    }
    if (entry.action === 'opportunity_edited') return 'Opportunity details updated'
    if (entry.action === 'owner_changed') {
      const d = entry.details as { to?: string } | null
      return `Owner assigned${d?.to ? `: ${d.to}` : ''}`
    }
    return entry.action.replace(/_/g, ' ')
  }

  return (
    <ol className="space-y-3">
      {entries.map(entry => (
        <li key={entry.id} className="flex gap-3">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-2 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-700">{describe(entry)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ── Main component ────────────────────────────────────────────
export function OpportunityDetail() {
  const { id }      = useParams<{ id: string }>()
  const { user }    = useAuth()
  const queryClient = useQueryClient()

  const { data: opportunity, isLoading } = useQuery<Opportunity>({
    queryKey: ['opportunity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities').select('*').eq('id', id!).single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name')
      if (error) throw error
      return data ?? []
    },
  })

  const { data: activity = [] } = useQuery<ActivityEntry[]>({
    queryKey: ['activity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_log').select('*').eq('opportunity_id', id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!id,
  })

  // ── Status mutation (with optional auto-generate) ──────────
  const { mutate: changeStatus, isPending: statusPending } = useMutation({
    mutationFn: async (newStatus: string) => {
      const oldStatus = opportunity!.status
      if (oldStatus === newStatus) return

      const { error } = await supabase
        .from('opportunities')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id!)
      if (error) throw error

      await supabase.from('activity_log').insert({
        opportunity_id: id, actor_id: user?.id ?? null,
        action: 'status_changed', details: { from: oldStatus, to: newStatus },
      })

      // Auto-generate tasks when entering a template-trigger stage
      if (AUTO_GEN_STAGES.has(newStatus)) {
        const { count } = await supabase
          .from('tasks').select('*', { count: 'exact', head: true })
          .eq('opportunity_id', id!)
        if ((count ?? 0) === 0) {
          const templateId = TEMPLATE_IDS[opportunity!.type_id]
          const { data: items } = await supabase
            .from('task_template_items').select('*')
            .eq('template_id', templateId).order('sort_order')
          if (items?.length) {
            const base = opportunity!.primary_deadline
              ? new Date(opportunity!.primary_deadline)
              : new Date()
            await supabase.from('tasks').insert(
              items.map((item, i) => ({
                opportunity_id: id,
                title:          item.title,
                due_date:       addDays(base, item.days_offset).toISOString(),
                assignee_id:    opportunity!.owner_id ?? user?.id ?? null,
                sort_order:     i,
                status:         'not_started',
                days_offset:    item.days_offset,
              }))
            )
            await supabase.from('activity_log').insert({
              opportunity_id: id, actor_id: user?.id ?? null,
              action: 'tasks_generated', details: { count: items.length, template: templateId },
            })
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunity', id] })
      queryClient.invalidateQueries({ queryKey: ['activity', id] })
      queryClient.invalidateQueries({ queryKey: ['tasks', id] })
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
    },
  })

  // ── Owner mutation ─────────────────────────────────────────
  const { mutate: changeOwner } = useMutation({
    mutationFn: async (profileId: string | null) => {
      const { error } = await supabase
        .from('opportunities')
        .update({ owner_id: profileId, updated_at: new Date().toISOString() })
        .eq('id', id!)
      if (error) throw error
      const ownerName = profiles.find(p => p.id === profileId)?.full_name ?? null
      await supabase.from('activity_log').insert({
        opportunity_id: id, actor_id: user?.id ?? null,
        action: 'owner_changed', details: { to: ownerName },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunity', id] })
      queryClient.invalidateQueries({ queryKey: ['activity', id] })
    },
  })

  // ── Loading / not found ────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-8 flex justify-center py-20">
        <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!opportunity) {
    return (
      <div className="p-8">
        <p className="text-gray-400 text-sm">Opportunity not found.</p>
        <Link to="/admin/opportunities" className="text-sm text-river hover:underline mt-2 inline-block">
          ← Back to opportunities
        </Link>
      </div>
    )
  }

  const isGrant     = opportunity.type_id === 'grant'
  const orgOrFunder = opportunity.funder ?? opportunity.partner_org
  const owner       = profiles.find(p => p.id === opportunity.owner_id)

  return (
    <div className="p-8 max-w-4xl">
      {/* Back */}
      <Link
        to="/admin/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-navy mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        Opportunities
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
              isGrant ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
            }`}>
              {opportunity.type_id}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-navy">{opportunity.name}</h1>
          {orgOrFunder && <p className="text-sm text-gray-400 mt-1">{orgOrFunder}</p>}
        </div>
        <Link
          to={`/admin/opportunities/${id}/edit`}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-navy border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 transition-colors shrink-0"
        >
          <Pencil size={13} />
          Edit
        </Link>
      </div>

      {/* Pipeline stepper */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-4 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-3">Status</p>
        <PipelineStepper
          stages={isGrant ? GRANT_STAGES : PARTNERSHIP_STAGES}
          terminal={isGrant ? GRANT_TERMINAL : PARTNERSHIP_TERMINAL}
          currentStatus={opportunity.status}
          color={isGrant ? 'river' : 'trail'}
          onSelect={changeStatus}
          isPending={statusPending}
        />
      </div>

      {/* Quick facts + owner */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-8 text-sm text-gray-500">
        {opportunity.primary_deadline && (
          <span className="flex items-center gap-1.5">
            <Calendar size={14} className="text-gray-400" />
            {format(new Date(opportunity.primary_deadline), 'MMM d, yyyy')}
          </span>
        )}
        {opportunity.tags.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Tag size={14} className="text-gray-400" />
            {opportunity.tags.join(', ')}
          </span>
        )}

        {/* Owner picker */}
        <span className="flex items-center gap-1.5">
          <UserCircle size={14} className="text-gray-400" />
          <select
            value={opportunity.owner_id ?? ''}
            onChange={e => changeOwner(e.target.value || null)}
            className="text-sm text-gray-500 bg-transparent border-none outline-none cursor-pointer hover:text-navy transition-colors"
          >
            <option value="">Unassigned</option>
            {profiles.map(p => (
              <option key={p.id} value={p.id}>{p.full_name || p.id}</option>
            ))}
          </select>
          {owner && <span className="text-gray-400">({owner.full_name})</span>}
        </span>
      </div>

      {/* Details grid */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Details</h2>
          {opportunity.description && (
            <p className="text-sm text-gray-600 leading-relaxed mb-4">{opportunity.description}</p>
          )}
          <DetailRow label="Deadline" value={opportunity.primary_deadline ? format(new Date(opportunity.primary_deadline), 'MMMM d, yyyy') : null} />
          <DetailRow label="Source"   value={opportunity.source_url ? <a href={opportunity.source_url} target="_blank" rel="noopener noreferrer" className="text-river hover:underline truncate">{opportunity.source_url}</a> : null} />
          <DetailRow label="Created"  value={format(new Date(opportunity.created_at), 'MMM d, yyyy')} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            {isGrant ? 'Grant Info' : 'Partnership Info'}
          </h2>
          {isGrant ? (
            <>
              <DetailRow label="Funder"      value={opportunity.funder} />
              <DetailRow label="Grant type"  value={opportunity.grant_type} />
              <DetailRow label="Max amount"  value={opportunity.amount_max != null ? `$${opportunity.amount_max.toLocaleString()}` : null} />
              <DetailRow label="Requesting"  value={opportunity.amount_requested != null ? `$${opportunity.amount_requested.toLocaleString()}` : null} />
              <DetailRow label="Awarded"     value={opportunity.amount_awarded != null ? `$${opportunity.amount_awarded.toLocaleString()}` : null} />
              <DetailRow label="LOI due"     value={opportunity.loi_deadline ? format(new Date(opportunity.loi_deadline), 'MMM d, yyyy') : null} />
              <DetailRow label="CFDA #"      value={opportunity.cfda_number} />
              <DetailRow label="Eligibility" value={opportunity.eligibility_notes} />
            </>
          ) : (
            <>
              <DetailRow label="Partner org" value={opportunity.partner_org} />
              <DetailRow label="Contact"     value={opportunity.primary_contact} />
              <DetailRow label="Email"       value={opportunity.contact_email} />
              <DetailRow label="Phone"       value={opportunity.contact_phone} />
              <DetailRow label="Type"        value={opportunity.partnership_type} />
              <DetailRow label="Agreement"   value={opportunity.agreement_date ? format(new Date(opportunity.agreement_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Renewal"     value={opportunity.renewal_date ? format(new Date(opportunity.renewal_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Est. value"  value={opportunity.estimated_value != null ? `$${opportunity.estimated_value.toLocaleString()}` : null} />
              <DetailRow label="Alignment"   value={opportunity.alignment_notes} />
            </>
          )}
        </div>
      </div>

      {/* Tasks */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <TaskPanel
          opportunityId={id!}
          typeId={opportunity.type_id}
          primaryDeadline={opportunity.primary_deadline}
          ownerId={opportunity.owner_id}
        />
      </div>

      {/* Activity log */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Activity</h2>
        <ActivityLog entries={activity} />
      </div>
    </div>
  )
}
