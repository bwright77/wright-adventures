import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Opportunity, OpportunityTypeId, GrantType, PartnershipType } from '../../lib/types'

// ── Schemas (same shape as NewOpportunity) ────────────────────
const baseSchema = z.object({
  name:             z.string().min(1, 'Name is required'),
  description:      z.string().optional(),
  primary_deadline: z.string().optional(),
  source_url:       z.string().url('Enter a valid URL').or(z.literal('')).optional(),
  tags:             z.string().optional(),
})

const grantSchema = baseSchema.extend({
  funder:            z.string().optional(),
  grant_type:        z.enum(['federal', 'state', 'foundation', 'corporate', 'other']).optional(),
  amount_max:        z.string().optional(),
  amount_requested:  z.string().optional(),
  loi_deadline:      z.string().optional(),
  cfda_number:       z.string().optional(),
  eligibility_notes: z.string().optional(),
})

const partnershipSchema = baseSchema.extend({
  partner_org:      z.string().optional(),
  primary_contact:  z.string().optional(),
  contact_email:    z.string().email('Enter a valid email').or(z.literal('')).optional(),
  contact_phone:    z.string().optional(),
  partnership_type: z.enum(['mou', 'joint_program', 'coalition', 'referral', 'in_kind', 'other']).optional(),
  estimated_value:  z.string().optional(),
  alignment_notes:  z.string().optional(),
})

// ── Field helpers ─────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-500 mb-1">{children}</label>
}
function Input({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <>
      <input {...props} className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors ${error ? 'border-red-300' : 'border-gray-200'}`} />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}
function Textarea({ error, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }) {
  return (
    <>
      <textarea {...props} rows={3} className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors resize-none ${error ? 'border-red-300' : 'border-gray-200'}`} />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}
function Select({ error, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  return (
    <>
      <select {...props} className={`w-full border rounded-lg px-3 py-2 text-sm text-navy focus:outline-none focus:ring-2 focus:ring-river/20 focus:border-river/40 transition-colors bg-white ${error ? 'border-red-300' : 'border-gray-200'}`}>{children}</select>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </>
  )
}

// ── Helpers ───────────────────────────────────────────────────
function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  try { return format(new Date(iso), 'yyyy-MM-dd') } catch { return '' }
}

// ── Main component ────────────────────────────────────────────
export function EditOpportunity() {
  const { id }    = useParams<{ id: string }>()
  const { user }  = useAuth()
  const navigate  = useNavigate()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: opp, isLoading } = useQuery<Opportunity>({
    queryKey: ['opportunity', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('*')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!id,
  })

  const isGrant = opp?.type_id === 'grant'

  const schema = isGrant ? grantSchema : partnershipSchema
  type FormValues = z.infer<typeof typeof schema>

  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<z.infer<typeof schema>>({
      resolver: zodResolver(schema),
      values: opp ? buildDefaults(opp) : undefined,
    })

  function buildDefaults(o: Opportunity) {
    const base = {
      name:             o.name,
      description:      o.description ?? '',
      primary_deadline: toDateInput(o.primary_deadline),
      source_url:       o.source_url ?? '',
      tags:             o.tags.join(', '),
    }
    if (o.type_id === 'grant') {
      return {
        ...base,
        funder:            o.funder ?? '',
        grant_type:        o.grant_type ?? undefined,
        amount_max:        o.amount_max != null ? String(o.amount_max) : '',
        amount_requested:  o.amount_requested != null ? String(o.amount_requested) : '',
        loi_deadline:      toDateInput(o.loi_deadline),
        cfda_number:       o.cfda_number ?? '',
        eligibility_notes: o.eligibility_notes ?? '',
      }
    }
    return {
      ...base,
      partner_org:      o.partner_org ?? '',
      primary_contact:  o.primary_contact ?? '',
      contact_email:    o.contact_email ?? '',
      contact_phone:    o.contact_phone ?? '',
      partnership_type: o.partnership_type ?? undefined,
      estimated_value:  o.estimated_value != null ? String(o.estimated_value) : '',
      alignment_notes:  o.alignment_notes ?? '',
    }
  }

  async function onSubmit(values: z.infer<typeof schema>) {
    setSubmitError(null)
    const tags = values.tags
      ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      : []

    const payload: Record<string, unknown> = {
      name:             values.name,
      description:      values.description || null,
      primary_deadline: values.primary_deadline || null,
      source_url:       values.source_url || null,
      tags,
      updated_at:       new Date().toISOString(),
    }

    if (isGrant) {
      const v = values as z.infer<typeof grantSchema>
      payload.funder            = v.funder || null
      payload.grant_type        = v.grant_type || null
      payload.amount_max        = v.amount_max ? Number(v.amount_max) : null
      payload.amount_requested  = v.amount_requested ? Number(v.amount_requested) : null
      payload.loi_deadline      = v.loi_deadline || null
      payload.cfda_number       = v.cfda_number || null
      payload.eligibility_notes = v.eligibility_notes || null
    } else {
      const v = values as z.infer<typeof partnershipSchema>
      payload.partner_org      = v.partner_org || null
      payload.primary_contact  = v.primary_contact || null
      payload.contact_email    = v.contact_email || null
      payload.contact_phone    = v.contact_phone || null
      payload.partnership_type = v.partnership_type || null
      payload.estimated_value  = v.estimated_value ? Number(v.estimated_value) : null
      payload.alignment_notes  = v.alignment_notes || null
    }

    const { error } = await supabase
      .from('opportunities')
      .update(payload)
      .eq('id', id!)

    if (error) { setSubmitError(error.message); return }

    await supabase.from('activity_log').insert({
      opportunity_id: id,
      actor_id:       user?.id ?? null,
      action:         'opportunity_edited',
      details:        null,
    })

    navigate(`/admin/opportunities/${id}`)
  }

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center py-20">
        <div className="w-5 h-5 border-2 border-river border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!opp) {
    return <div className="p-8 text-sm text-gray-400">Opportunity not found.</div>
  }

  const e = errors as Record<string, { message?: string }>

  return (
    <div className="p-8 max-w-3xl">
      <Link
        to={`/admin/opportunities/${id}`}
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-navy mb-6 transition-colors"
      >
        <ArrowLeft size={14} />
        {opp.name}
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-2xl font-bold text-navy">Edit Opportunity</h1>
        <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
          isGrant ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
        }`}>
          {opp.type_id}
        </span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
            {isGrant ? 'Grant Info' : 'Partnership Info'}
          </h2>

          {isGrant ? (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Funder</Label><Input {...register('funder' as never)} placeholder="Foundation or agency name" /></div>
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
                <div><Label>Max amount ($)</Label><Input {...register('amount_max' as never)} type="number" min="0" placeholder="0" /></div>
                <div><Label>Amount requesting ($)</Label><Input {...register('amount_requested' as never)} type="number" min="0" placeholder="0" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>LOI deadline</Label><Input {...register('loi_deadline' as never)} type="date" /></div>
                <div><Label>CFDA #</Label><Input {...register('cfda_number' as never)} placeholder="XX.XXX" /></div>
              </div>
              <div><Label>Eligibility notes</Label><Textarea {...register('eligibility_notes' as never)} placeholder="Who is eligible, restrictions…" /></div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Partner organization</Label><Input {...register('partner_org' as never)} placeholder="Org name" /></div>
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
                <div><Label>Primary contact</Label><Input {...register('primary_contact' as never)} placeholder="Full name" /></div>
                <div><Label>Contact email</Label><Input {...register('contact_email' as never)} type="email" placeholder="contact@org.org" error={e.contact_email?.message} /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><Label>Contact phone</Label><Input {...register('contact_phone' as never)} placeholder="(555) 000-0000" /></div>
                <div><Label>Estimated value ($)</Label><Input {...register('estimated_value' as never)} type="number" min="0" placeholder="0" /></div>
              </div>
              <div><Label>Alignment notes</Label><Textarea {...register('alignment_notes' as never)} placeholder="How this aligns with our mission…" /></div>
            </div>
          )}
        </div>

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
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
          <Link to={`/admin/opportunities/${id}`} className="text-sm text-gray-400 hover:text-navy transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
