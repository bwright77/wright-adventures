import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Star, Pencil, Trash2, Linkedin, Mail, Phone, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { PartnershipContact } from '../../lib/types'

// ── Schema ────────────────────────────────────────────────────
const contactSchema = z.object({
  full_name:    z.string().min(1, 'Name is required'),
  title:        z.string().optional(),
  email:        z.string().email('Invalid email').optional().or(z.literal('')),
  phone:        z.string().optional(),
  linkedin_url: z.string().url('Invalid URL').optional().or(z.literal('')),
  notes:        z.string().optional(),
})
type ContactForm = z.infer<typeof contactSchema>

// ── ContactCard ───────────────────────────────────────────────
function ContactCard({
  contact,
  canEdit,
  onSetPrimary,
  onEdit,
  onDelete,
}: {
  contact:      PartnershipContact
  canEdit:      boolean
  onSetPrimary: (id: string) => void
  onEdit:       (contact: PartnershipContact) => void
  onDelete:     (id: string) => void
}) {
  return (
    <div className={`p-4 rounded-lg border transition-colors ${
      contact.is_primary
        ? 'border-trail/40 bg-trail/5'
        : 'border-gray-100 bg-white hover:border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-navy truncate">{contact.full_name}</span>
            {contact.is_primary && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-trail bg-trail/10 px-1.5 py-0.5 rounded-full shrink-0">
                <Star size={9} fill="currentColor" />
                Primary
              </span>
            )}
          </div>
          {contact.title && (
            <p className="text-xs text-gray-500 mt-0.5">{contact.title}</p>
          )}
          {contact.notes && (
            <p className="text-xs text-gray-400 mt-1 italic">{contact.notes}</p>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            {!contact.is_primary && (
              <button
                onClick={() => onSetPrimary(contact.id)}
                title="Set as primary contact"
                className="p-1.5 text-gray-300 hover:text-trail transition-colors rounded"
              >
                <Star size={13} />
              </button>
            )}
            <button
              onClick={() => onEdit(contact)}
              className="p-1.5 text-gray-300 hover:text-navy transition-colors rounded"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onDelete(contact.id)}
              className="p-1.5 text-gray-300 hover:text-red-400 transition-colors rounded"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Contact links */}
      <div className="flex flex-wrap gap-3 mt-2.5">
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-river transition-colors"
          >
            <Mail size={11} />
            {contact.email}
          </a>
        )}
        {contact.phone && (
          <a
            href={`tel:${contact.phone}`}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-river transition-colors"
          >
            <Phone size={11} />
            {contact.phone}
          </a>
        )}
        {contact.linkedin_url && (
          <a
            href={contact.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#0a66c2] transition-colors"
          >
            <Linkedin size={11} />
            LinkedIn
          </a>
        )}
      </div>
    </div>
  )
}

// ── ContactForm ───────────────────────────────────────────────
function ContactFormPanel({
  opportunityId,
  editing,
  onClose,
}: {
  opportunityId: string
  editing:       PartnershipContact | null
  onClose:       () => void
}) {
  const queryClient = useQueryClient()
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ContactForm>({
    resolver: zodResolver(contactSchema),
    defaultValues: editing ? {
      full_name:    editing.full_name,
      title:        editing.title ?? '',
      email:        editing.email ?? '',
      phone:        editing.phone ?? '',
      linkedin_url: editing.linkedin_url ?? '',
      notes:        editing.notes ?? '',
    } : {},
  })

  const saveContact = useMutation({
    mutationFn: async (data: ContactForm) => {
      const payload = {
        full_name:    data.full_name,
        title:        data.title || null,
        email:        data.email || null,
        phone:        data.phone || null,
        linkedin_url: data.linkedin_url || null,
        notes:        data.notes || null,
      }
      if (editing) {
        const { error } = await supabase
          .from('partnership_contacts')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('partnership_contacts')
          .insert({ ...payload, opportunity_id: opportunityId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contacts', opportunityId] })
      onClose()
    },
  })

  return (
    <form
      onSubmit={handleSubmit(data => saveContact.mutate(data))}
      className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {editing ? 'Edit contact' : 'New contact'}
        </span>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <input
            {...register('full_name')}
            placeholder="Full name *"
            autoFocus
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
          {errors.full_name && (
            <p className="text-xs text-red-500 mt-0.5">{errors.full_name.message}</p>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <input
            {...register('title')}
            placeholder="Title / role"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <input
            {...register('email')}
            type="email"
            placeholder="Email"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
          {errors.email && (
            <p className="text-xs text-red-500 mt-0.5">{errors.email.message}</p>
          )}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <input
            {...register('phone')}
            placeholder="Phone"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
        </div>
        <div className="col-span-2">
          <input
            {...register('linkedin_url')}
            placeholder="LinkedIn URL"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
          />
          {errors.linkedin_url && (
            <p className="text-xs text-red-500 mt-0.5">{errors.linkedin_url.message}</p>
          )}
        </div>
        <div className="col-span-2">
          <input
            {...register('notes')}
            placeholder="Notes (e.g. decision-maker, champion, gatekeeper)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40"
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
          disabled={isSubmitting || saveContact.isPending}
          className="flex items-center gap-1.5 text-xs bg-trail hover:bg-trail/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {saveContact.isPending ? (
            <div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <Check size={12} />
          )}
          {editing ? 'Save changes' : 'Add contact'}
        </button>
      </div>
    </form>
  )
}

// ── Main component ────────────────────────────────────────────
export function ContactsPanel({ opportunityId }: { opportunityId: string }) {
  const { profile }    = useAuth()
  const queryClient    = useQueryClient()
  const [adding, setAdding]   = useState(false)
  const [editing, setEditing] = useState<PartnershipContact | null>(null)

  const canEdit = profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'member'
  const canDelete = profile?.role === 'admin' || profile?.role === 'manager'

  const { data: contacts = [], isLoading } = useQuery<PartnershipContact[]>({
    queryKey: ['contacts', opportunityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partnership_contacts')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('is_primary', { ascending: false })
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
  })

  const setPrimary = useMutation({
    mutationFn: async (contactId: string) => {
      // Clear all primaries for this opportunity then set the new one
      await supabase
        .from('partnership_contacts')
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('opportunity_id', opportunityId)
      const { error } = await supabase
        .from('partnership_contacts')
        .update({ is_primary: true, updated_at: new Date().toISOString() })
        .eq('id', contactId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts', opportunityId] }),
  })

  const deleteContact = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await supabase
        .from('partnership_contacts')
        .delete()
        .eq('id', contactId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['contacts', opportunityId] }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em]">
          Contacts
          {contacts.length > 0 && (
            <span className="ml-2 text-navy normal-case tracking-normal font-medium">
              {contacts.length}
            </span>
          )}
        </h2>
        {canEdit && !adding && !editing && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-trail hover:text-trail/80 transition-colors"
          >
            <Plus size={13} />
            Add contact
          </button>
        )}
      </div>

      {(adding || editing) && (
        <div className="mb-4">
          <ContactFormPanel
            opportunityId={opportunityId}
            editing={editing}
            onClose={() => { setAdding(false); setEditing(null) }}
          />
        </div>
      )}

      {isLoading ? (
        <div className="py-6 flex justify-center">
          <div className="w-4 h-4 border-2 border-trail border-t-transparent rounded-full animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-2">
          No contacts yet — add key stakeholders to track your relationships.
        </p>
      ) : (
        <div className="space-y-2">
          {contacts.map(c => (
            <ContactCard
              key={c.id}
              contact={c}
              canEdit={canDelete}
              onSetPrimary={id => setPrimary.mutate(id)}
              onEdit={contact => { setEditing(contact); setAdding(false) }}
              onDelete={id => deleteContact.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
