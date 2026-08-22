// =============================================================================
// usePipelineStatuses — read stages from the database instead of hardcoding them.
//
// The stage list has changed four times in a day: prospecting/qualifying folded
// into identified/contacted, evaluation and approval and nurture added,
// evaluation removed and restored, then identified/contacted replaced by
// qualifying once Nurture took over the pre-opportunity phase.
//
// Each of those changes was a migration plus four hardcoded arrays in two files
// — the kanban columns, the filter dropdown, the status labels, and the detail
// stepper. They drifted, and the visible symptom was a filter still offering
// stages that no longer existed while omitting the ones that did.
//
// pipeline_statuses is already the source of truth: opportunities.status is a
// foreign key to it and sort_order already defines board order. So read it.
// Adding a stage is now one INSERT with no UI change.
// =============================================================================

import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { PipelineStatus } from './types'

/** Terminal stages get colour; the rest inherit the neutral default. */
export const STATUS_COLORS: Record<string, string> = {
  partnership_closed_won:  'bg-trail-50 text-trail',
  partnership_closed_lost: 'bg-red-50 text-red-600',
  partnership_nurture:     'bg-amber-50 text-amber-700',
}

export interface PipelineStages {
  /** Every stage for the type, in sort_order. */
  all: PipelineStatus[]
  /** id → label, for rendering a status without a lookup dance. */
  labels: Record<string, string>
  /** Stages whose ids appear in `ids`, in sort_order. For kanban columns. */
  columnsFor: (ids: readonly string[]) => PipelineStatus[]
  isLoading: boolean
}

export function usePipelineStatuses(typeId: string): PipelineStages {
  const { data: all = [], isLoading } = useQuery<PipelineStatus[]>({
    queryKey: ['pipeline_statuses', typeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_statuses')
        .select('*')
        .eq('type_id', typeId)
        .eq('is_active', true)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as PipelineStatus[]
    },
    // Stages change on the order of once a quarter, not once a minute.
    staleTime: 10 * 60 * 1000,
  })

  return {
    all,
    labels: Object.fromEntries(all.map(s => [s.id, s.label])),
    columnsFor: (ids) => all.filter(s => ids.includes(s.id)),
    isLoading,
  }
}
