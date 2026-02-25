import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { OpportunityTypeId, GrantType, PartnershipType } from '../../lib/types'

// ── Shared fields ─────────────────────────────────────────────
const baseSchema = z.object({
  type_id:          z.enum(['grant', 'partnership']),
  name:             z.string().min(1, 'Name is required'),
  description:      z.string().optional(),
  primary_deadline: z.string().optional(),
  source_url:       z.string().url('Enter a valid URL').or(z.literal('')).optional(),
  tags:             z.string().optional(), // comma-separated, split on save
})

// ── Grant extras ──────────────────────────────────────────────
const grantSchema = baseSchema.extend({
  type_id:           z.literal('grant'),
  funder:            z.string().optional(),
  grant_type:        z.enum(['federal', 'state', 'foundation', 'corporate', 'other']).optional(),
  amount_max:        z.string().optional(),
  amount_requested:  z.string().optional(),
  loi_deadline:      z.string().optional(),
  cfda_number:       z.string().optional(),
  eligibility_notes: z.string().optional(),
})

// ── Partnership extras ────────────────────────────────────────
const partnershipSchema = baseSchema.extend({
  type_id:          z.literal('partnership'),
  partner_org:      z.string().optional(),
  primary_contact:  z.string().optional(),
  contact_email:    z.string().email('Enter a valid email').or(z.literal('')).optional(),
  contact_phone:    z.string().optional(),
  partnership_type: z.enum(['mou', 'joint_program', 'coalition', 'referral', 'in_kind', 'other']).optional(),
  estimated_value:  z.string().optional(),
  alignment_notes:  z.string().optional(),
})

const schema = z.discriminatedUnion('type_id', [grantSchema, partnershipSchema])
type FormValues = z.infer<typeof schema>

// ── Default statuses ──────────────────────────────────────────
const DEFAULT_STATUS: Record<OpportunityTypeId, string> = {
  grant:       'grant_identified',
  partnership: 'partnership_prospecting',
}

// ── Field helpers ─────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-500 mb-1">{children}</label>
}

function Input({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <>
      <input
        {...props}
        className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors ${
          error ? 'border-red-300' : 'border-gray-200'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}

function Textarea({ error, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <>
      <textarea
        {...props}
        rows={3}
        className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors resize-none ${
          error ? 'border-red-300' : 'border-gray-200'
        }`}
      />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}

function Select({ error, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <>
      <select
        {...props}
        className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors bg-white ${
          error ? 'border-red-300' : 'border-gray-200'
        }`}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}

// ── Main component ────────────────────────────────────────────
export function NewOpportunity() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      defaultValues: { type_id: 'grant' },
    })

  const typeId = watch('type_id') as OpportunityTypeId

  async function onSubmit(values: FormValues) {
    setSubmitError(null)

    const tags = values.tags
      ? values.tags.split(',').map(t => t.trim()).filter(Boolean)
      : []

    // Build the DB payload — coerce empty strings to null, numbers from strings
    const payload: Record<string, unknown> = {
      type_id:          values.type_id,
      name:             values.name,
      description:      values.description || null,
      primary_deadline: values.primary_deadline || null,
      source_url:       values.source_url || null,
      status:           DEFAULT_STATUS[values.type_id],
      tags,
      created_by:       user?.id ?? null,
    }

    if (values.type_id === 'grant') {
      payload.funder            = values.funder || null
      payload.grant_type        = values.grant_type || null
      payload.amount_max        = values.amount_max ? Number(values.amount_max) : null
      payload.amount_requested  = values.amount_requested ? Number(values.amount_requested) : null
      payload.loi_deadline      = values.loi_deadline || null
      payload.cfda_number       = values.cfda_number || null
      payload.eligibility_notes = values.eligibility_notes || null
    } else {
      payload.partner_org      = values.partner_org || null
      payload.primary_contact  = values.primary_contact || null
      payload.contact_email    = values.contact_email || null
      payload.contact_phone    = values.contact_phone || null
      payload.partnership_type = values.partnership_type || null
      payload.estimated_value  = values.estimated_value ? Number(values.estimated_value) : null
      payload.alignment_notes  = values.alignment_notes || null
    }

    const { data, error } = await supabase
      .from('opportunities')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      setSubmitError(error.message)
      return
    }

    navigate(`/admin/opportunities/${data.id}`)
  }

  const e = errors as Record<string, { message?: string }>

  return (
    <div className="p-8 max-w-3xl">
      {/* Back */}
      <Link
        to="/admin/opportunities"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-navy mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        Opportunities
      </Link>

      <h1 className="text-2xl font-bold text-navy mb-8">New Opportunity</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* Type toggle */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Type</h2>
          <div className="flex gap-3">
            {(['grant', 'partnership'] as OpportunityTypeId[]).map(t => (
              <label
                key={t}
                className={`flex-1 flex items-center justify-center gap-2 border rounded-lg py-2.5 text-sm font-medium cursor-pointer transition-colors ${
                  typeId === t
                    ? t === 'grant'
                      ? 'bg-river-50 border-river/30 text-river'
                      : 'bg-trail-50 border-trail/30 text-trail'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                <input {...register('type_id')} type="radio" value={t} className="sr-only" />
                {t === 'grant' ? 'Grant' : 'Partnership'}
              </label>
            ))}
          </div>
        </div>

        {/* Core fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">Details</h2>
          <div className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input {...register('name')} placeholder="Opportunity name" error={e.name?.message} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea {...register('description')} placeholder="Brief summary…" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label>Primary deadline</Label>
                <Input {...register('primary_deadline')} type="date" />
              </div>
              <div>
                <Label>Source URL</Label>
                <Input {...register('source_url')} type="url" placeholder="https://…" error={e.source_url?.message} />
              </div>
            </div>
            <div>
              <Label>Tags</Label>
              <Input {...register('tags')} placeholder="watershed, youth, federal (comma-separated)" />
            </div>
          </div>
        </div>

        {/* Type-specific fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            {typeId === 'grant' ? 'Grant Info' : 'Partnership Info'}
          </h2>

          {typeId === 'grant' ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Funder</Label>
                  <Input {...register('funder' as never)} placeholder="Foundation or agency name" />
                </div>
                <div>
                  <Label>Grant type</Label>
                  <Select {...register('grant_type' as never)}>
                    <option value="">Select…</option>
                    {(['federal', 'state', 'foundation', 'corporate', 'other'] as GrantType[]).map(g => (
                      <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Max amount ($)</Label>
                  <Input {...register('amount_max' as never)} type="number" min="0" placeholder="0" />
                </div>
                <div>
                  <Label>Amount requesting ($)</Label>
                  <Input {...register('amount_requested' as never)} type="number" min="0" placeholder="0" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>LOI deadline</Label>
                  <Input {...register('loi_deadline' as never)} type="date" />
                </div>
                <div>
                  <Label>CFDA #</Label>
                  <Input {...register('cfda_number' as never)} placeholder="XX.XXX" />
                </div>
              </div>
              <div>
                <Label>Eligibility notes</Label>
                <Textarea {...register('eligibility_notes' as never)} placeholder="Who is eligible, restrictions…" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Partner organization</Label>
                  <Input {...register('partner_org' as never)} placeholder="Org name" />
                </div>
                <div>
                  <Label>Partnership type</Label>
                  <Select {...register('partnership_type' as never)}>
                    <option value="">Select…</option>
                    {(['mou', 'joint_program', 'coalition', 'referral', 'in_kind', 'other'] as PartnershipType[]).map(p => (
                      <option key={p} value={p}>{p.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Primary contact</Label>
                  <Input {...register('primary_contact' as never)} placeholder="Full name" />
                </div>
                <div>
                  <Label>Contact email</Label>
                  <Input {...register('contact_email' as never)} type="email" placeholder="contact@org.org" error={e.contact_email?.message} />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label>Contact phone</Label>
                  <Input {...register('contact_phone' as never)} placeholder="(555) 000-0000" />
                </div>
                <div>
                  <Label>Estimated value ($)</Label>
                  <Input {...register('estimated_value' as never)} type="number" min="0" placeholder="0" />
                </div>
              </div>
              <div>
                <Label>Alignment notes</Label>
                <Textarea {...register('alignment_notes' as never)} placeholder="How this aligns with our mission…" />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        {submitError && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {submitError}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-river hover:bg-river/90 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
          >
            {isSubmitting ? 'Saving…' : 'Create opportunity'}
          </button>
          <Link
            to="/admin/opportunities"
            className="text-sm text-gray-400 hover:text-navy transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
