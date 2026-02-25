import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Calendar, User, Tag } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { Opportunity } from '../../lib/types'

const STATUS_LABELS: Record<string, string> = {
  grant_identified:        'Identified',
  grant_evaluating:        'Evaluating',
  grant_preparing:         'Preparing',
  grant_submitted:         'Submitted',
  grant_under_review:      'Under Review',
  grant_awarded:           'Awarded',
  grant_declined:          'Declined',
  grant_withdrawn:         'Withdrawn',
  grant_archived:          'Archived',
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-gray-50 last:border-0">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-[0.07em] sm:w-40 shrink-0 mt-0.5">{label}</span>
      <span className="text-sm text-navy">{value}</span>
    </div>
  )
}

export function OpportunityDetail() {
  const { id } = useParams<{ id: string }>()

  const { data: opportunity, isLoading } = useQuery<Opportunity>({
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

  const isGrant       = opportunity.type_id === 'grant'
  const statusLabel   = STATUS_LABELS[opportunity.status] ?? opportunity.status
  const orgOrFunder   = opportunity.funder ?? opportunity.partner_org

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
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded capitalize ${
            isGrant ? 'bg-river-50 text-river' : 'bg-trail-50 text-trail'
          }`}>
            {opportunity.type_id}
          </span>
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600">
            {statusLabel}
          </span>
        </div>
        <h1 className="text-2xl font-bold text-navy">{opportunity.name}</h1>
        {orgOrFunder && <p className="text-sm text-gray-400 mt-1">{orgOrFunder}</p>}
      </div>

      {/* Quick facts */}
      <div className="flex flex-wrap gap-4 mb-8 text-sm text-gray-500">
        {opportunity.primary_deadline && (
          <span className="flex items-center gap-1.5">
            <Calendar size={14} className="text-gray-400" />
            {format(new Date(opportunity.primary_deadline), 'MMM d, yyyy')}
          </span>
        )}
        {opportunity.owner_id && (
          <span className="flex items-center gap-1.5">
            <User size={14} className="text-gray-400" />
            Owner assigned
          </span>
        )}
        {opportunity.tags.length > 0 && (
          <span className="flex items-center gap-1.5">
            <Tag size={14} className="text-gray-400" />
            {opportunity.tags.join(', ')}
          </span>
        )}
      </div>

      {/* Details */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Core fields */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-[0.08em] mb-4">
            Details
          </h2>
          {opportunity.description && (
            <p className="text-sm text-gray-600 leading-relaxed mb-4">{opportunity.description}</p>
          )}
          <DetailRow label="Status"   value={statusLabel} />
          <DetailRow label="Deadline" value={opportunity.primary_deadline ? format(new Date(opportunity.primary_deadline), 'MMMM d, yyyy') : null} />
          <DetailRow label="Source"   value={opportunity.source_url ? <a href={opportunity.source_url} target="_blank" rel="noopener noreferrer" className="text-river hover:underline truncate">{opportunity.source_url}</a> : null} />
          <DetailRow label="Created"  value={format(new Date(opportunity.created_at), 'MMM d, yyyy')} />
        </div>

        {/* Type-specific fields */}
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
              <DetailRow label="Partner org"   value={opportunity.partner_org} />
              <DetailRow label="Contact"       value={opportunity.primary_contact} />
              <DetailRow label="Email"         value={opportunity.contact_email} />
              <DetailRow label="Phone"         value={opportunity.contact_phone} />
              <DetailRow label="Type"          value={opportunity.partnership_type} />
              <DetailRow label="Agreement"     value={opportunity.agreement_date ? format(new Date(opportunity.agreement_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Renewal"       value={opportunity.renewal_date ? format(new Date(opportunity.renewal_date), 'MMM d, yyyy') : null} />
              <DetailRow label="Est. value"    value={opportunity.estimated_value != null ? `$${opportunity.estimated_value.toLocaleString()}` : null} />
              <DetailRow label="Alignment"     value={opportunity.alignment_notes} />
            </>
          )}
        </div>
      </div>

      {/* Sprint 1 placeholder */}
      <div className="mt-6 bg-white rounded-xl border border-gray-200 border-dashed p-6 text-center">
        <p className="text-sm text-gray-400 italic">
          Tasks, documents, and activity log — coming in Sprint 1.
        </p>
      </div>
    </div>
  )
}
