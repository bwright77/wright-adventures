import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Phone, Video, Mail, MessageSquare, Monitor,
  FileText, FileSignature, StickyNote, Plus, Check, X,
  ArrowUpRight, ArrowDownLeft, Users,
} from 'lucide-react'
import { format, formatDistanceToNow } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { PartnershipInteraction, PartnershipContact, InteractionType, InteractionDirection } from '../../lib/types'

// ── Icon map ──────────────────────────────────────────────────
const TYPE_ICONS: Record<InteractionType, React.ReactNode> = {
  call:           <Phone size={13} />,
  meeting:        <Video size={13} />,
  email:          <Mail size={13} />,
  message:        <MessageSquare size={13} />,
  demo:           <Monitor size={13} />,
  proposal_sent:  <FileText size={13} />,
  contract_sent:  <FileSignature size={13} />,
  note:           <StickyNote size={13} />,
  other:          <Users size={13} />,
}

const TYPE_LABELS: Record<InteractionType, string> = {
  call:           'Call',
  meeting:        'Meeting',
  email:          'Email',
  message:        'Message',
  demo:           'Demo',
  proposal_sent:  'Proposal Sent',
  contract_sent:  'Contract Sent',
  note:           'Note',
  other:          'Other',
}

const DIRECTION_ICONS: Record<InteractionDirection, React.ReactNode> = {
  outbound: <ArrowUpRight size={11} />,
  inbound:  <ArrowDownLeft size={11} />,
  internal: <Users size={11} />,
}

const DIRECTION_LABELS: Record<InteractionDirection, string> = {
  outbound: 'Outbound',
  inbound:  'Inbound',
  internal: 'Internal',
}

const DIRECTION_COLORS: Record<InteractionDirection, string> = {
  outbound: 'text-river bg-river/8',
  inbound:  'text-trail bg-trail/8',
  internal: 'text-gray-500 bg-gray-100',
}

// ── Schema ────────────────────────────────────────────────────
const interactionSchema = z.object({
  interaction_type: z.enum(['call','meeting','email','message','demo','proposal_sent','contract_sent','note','other']),
  direction:        z.enum(['inbound','outbound','internal']),
  contact_id:       z.string().optional(),
  subject:          z.string().optional(),
  occurred_at:      z.string().min(1, 'Date is required'),
  notes:            z.string().optional(),
})
type InteractionForm = z.infer<typeof interactionSchema>

// ── InteractionEntry ──────────────────────────────────────────
function InteractionEntry({ interaction }: { interaction: PartnershipInteraction }) {
  const [expanded, setExpanded] = useState(false)
  const hasNotes = interaction.notes.trim().length > 0
  const longNotes = interaction.notes.length > 140

  return (
    <li className="flex gap-3">
      {/* Icon column */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
          interaction.direction === 'outbound' ? 'bg-river/10 text-river'
          : interaction.direction === 'inbound' ? 'bg-trail/10 text-trail'
          : 'bg-gray-100 text-gray-500'
        }`}>
          {TYPE_ICONS[interaction.interaction_type]}
        </div>
        <div className="w-px flex-1 bg-gray-100 mt-1.5 mb-0" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          <span className="text-sm font-medium text-navy">
            {TYPE_LABELS[interaction.interaction_type]}
          </span>
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${DIRECTION_COLORS[interaction.direction]}`}>
            {DIRECTION_ICONS[interaction.direction]}
            {DIRECTION_LABELS[interaction.direction]}
          </span>
          {interaction.contact?.full_name && (
            <span className="text-xs text-gray-500">
              · {interaction.contact.full_name}
            </span>
          )}
        </div>

        {interaction.subject && (
          <p className="text-sm text-gray-700 font-medium mb-0.5">{interaction.subject}</p>
        )}

        {hasNotes && (
          <div>
            <p className={`text-sm text-gray-600 whitespace-pre-wrap ${!expanded && longNotes ? 'line-clamp-3' : ''}`}>
              {interaction.notes}
            </p>
            {longNotes && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="text-xs text-river hover:underline mt-0.5"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        <p className="text-xs text-gray-400 mt-1">
          {format(new Date(interaction.occurred_at), 'MMM d, yyyy · h:mm a')}
          {interaction.logger?.full_name && ` · ${interaction.logger.full_name}`}
          {' · '}
          <span title={new Date(interaction.occurred_at).toLocaleString()}>
            {formatDistanceToNow(new Date(interaction.occurred_at), { addSuffix: true })}
          </span>
        </p>
      </div>
    </li>
  )
}

// ── QuickAddForm ──────────────────────────────────────────────
function QuickAddForm({
  opportunityId,
  contacts,
  onClose,
}: {
  opportunityId: string
  contacts:      Pick<PartnershipContact, 'id' | 'full_name' | 'title'>[]
  onClose:       () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { register, control, handleSubmit, formState: { errors } } = useForm<InteractionForm>({
    resolver: zodResolver(interactionSchema),
    defaultValues: {
      interaction_type: 'call',
      direction:        'outbound',
      occurred_at:      new Date().toISOString().slice(0, 16), // datetime-local format
    },
  })

  const addInteraction = useMutation({
    mutationFn: async (data: InteractionForm) => {
      const { error } = await supabase.from('partnership_interactions').insert({
        opportunity_id:   opportunityId,
        interaction_type: data.interaction_type,
        direction:        data.direction,
        contact_id:       data.contact_id || null,
        subject:          data.subject || null,
        notes:            data.notes || '',
        occurred_at:      new Date(data.occurred_at).toISOString(),
        logged_by:        user?.id ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interactions', opportunityId] })
      queryClient.invalidateQueries({ queryKey: ['activity', opportunityId] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={handleSubmit(data => addInteraction.mutate(data))}
      className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3 mb-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Log interaction</span>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Type */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Type</label>
          <Controller
            name="interaction_type"
            control={control}
            render={({ field }) => (
              <select
                {...field}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 bg-white"
              >
                {(Object.keys(TYPE_LABELS) as InteractionType[]).map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            )}
          />
        </div>

        {/* Direction */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Direction</label>
          <Controller
            name="direction"
            control={control}
            render={({ field }) => (
              <select
                {...field}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 bg-white"
              >
                <option value="outbound">Outbound</option>
                <option value="inbound">Inbound</option>
                <option value="internal">Internal</option>
              </select>
            )}
          />
        </div>

        {/* Contact */}
        {contacts.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Contact</label>
            <select
              {...register('contact_id')}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 bg-white"
            >
              <option value="">— none —</option>
              {contacts.map(c => (
                <option key={c.id} value={c.id}>{c.full_name}{c.title ? ` (${c.title})` : ''}</option>
              ))}
            </select>
          </div>
        )}

        {/* Date */}
        <div className={contacts.length > 0 ? '' : 'col-span-2'}>
          <label className="text-xs text-gray-500 mb-1 block">Date & time *</label>
          <input
            type="datetime-local"
            {...register('occurred_at')}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
          {errors.occurred_at && (
            <p className="text-xs text-red-500 mt-0.5">{errors.occurred_at.message}</p>
          )}
        </div>

        {/* Subject */}
        <div className="col-span-2">
          <input
            {...register('subject')}
            placeholder="Subject (optional)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
        </div>

        {/* Notes */}
        <div className="col-span-2">
          <textarea
            {...register('notes')}
            placeholder="Notes — what was discussed, agreed, or discovered…"
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 resize-none"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={addInteraction.isPending}
          className="flex items-center gap-1.5 text-xs bg-trail hover:bg-trail/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {addInteraction.isPending ? (
            <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <Check size={12} />
          )}
          Log it
        </button>
      </div>
    </form>
  )
}

// ── Main component ────────────────────────────────────────────
export function InteractionsLog({ opportunityId }: { opportunityId: string }) {
  const { profile } = useAuth()
  const [adding, setAdding] = useState(false)

  const canAdd = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'member'

  const { data: interactions = [], isLoading } = useQuery<PartnershipInteraction[]>({
    queryKey: ['interactions', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partnership_interactions')
        .select(`
          *,
          contact:partnership_contacts(id, full_name),
          logger:profiles!logged_by(id, full_name, avatar_url)
        `)
        .eq('opportunity_id', opportunityId)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const { data: contacts = [] } = useQuery<Pick<PartnershipContact, 'id' | 'full_name' | 'title'>[]>({
    queryKey: ['contacts', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partnership_contacts')
        .select('id, full_name, title')
        .eq('opportunity_id', opportunityId)
        .order('is_primary', { ascending: false })
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Pick<PartnershipContact, 'id' | 'full_name' | 'title'>[]
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em]">
          Interactions
          {interactions.length > 0 && (
            <span className="ml-2 text-navy normal-case tracking-normal font-medium">
              {interactions.length}
            </span>
          )}
        </h2>
        {canAdd && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-trail hover:text-trail/80 transition-colors"
          >
            <Plus size={13} />
            Log interaction
          </button>
        )}
      </div>

      {adding && (
        <QuickAddForm
          opportunityId={opportunityId}
          contacts={contacts}
          onClose={() => setAdding(false)}
        />
      )}

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <div className="w-4 h-4 border-2 border-trail border-t-transparent rounded-full animate-spin" />
        </div>
      ) : interactions.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">
          No interactions logged yet — track calls, meetings, and emails here.
        </p>
      ) : (
        <ul className="space-y-0">
          {interactions.map(i => (
            <InteractionEntry key={i.id} interaction={i} />
          ))}
        </ul>
      )}
    </div>
  )
}
