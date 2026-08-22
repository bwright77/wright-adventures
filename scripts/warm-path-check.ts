import { createClient } from '@supabase/supabase-js'
import { SERVICE_LINE_LABELS } from '../src/lib/serviceLines'
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function warm() {
  const { data } = await supabase.from('organizations')
    .select('name, relationship_tier, relationship_basis, via:via_org_id(name), engagements(name, service_lines)')
    .in('relationship_tier', ['client','network']).eq('is_active', true)
  return (data ?? []).flatMap((o: any) => {
    const basis = o.relationship_basis?.trim() || null
    if (o.relationship_tier === 'network')
      return [{ org: o.name, tier: 'network', basis: basis ?? 'Being nurtured — known to us, no opportunity yet', via: o.via?.name ?? null }]
    const eng = (o.engagements ?? [])[0]
    const services = (eng?.service_lines ?? []).map((sl: string) => SERVICE_LINE_LABELS[sl] ?? sl).join(', ')
    return [{ org: o.name, tier: 'direct', basis: basis ?? (services ? `Client — ${services.toLowerCase()}` : eng ? `Client — ${eng.name}` : 'Client'), via: null }]
  })
}

async function main() {
  const r = await warm()
  console.log('warm path (' + r.length + ' orgs)\n')
  for (const x of r) console.log('  ' + x.tier.padEnd(8) + String(x.org).slice(0,34).padEnd(36) + String(x.basis).slice(0,44) + (x.via ? '  via ' + x.via : ''))
  console.log('\n  Climate Democracy (cold application) : ' + (r.find(x=>x.org.includes('Climate')) ? 'STILL INCLUDED — wrong' : 'excluded ✓'))
  console.log('  GOBRP (Shane knows Ted Rains)       : ' + (r.find(x=>x.org.includes('Golden Optimists')) ? 'included ✓' : 'MISSING — wrong'))
  for (const n of ['City Thread','Avasol','Golden Trout'])
    console.log('  ' + (n + ' (nurtured)').padEnd(34) + (r.find(x=>x.org.includes(n)) ? 'included ✓' : 'MISSING — wrong'))
}
main()
