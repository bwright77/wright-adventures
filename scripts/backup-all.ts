/**
 * Back up EVERY table, with the list derived from the database itself.
 *
 * The previous backup was a hand-written array of table names. It missed
 * lead_details — a table the very migration it was guarding went on to re-key —
 * and nobody noticed until data was wanted back. A list maintained by hand is
 * wrong the moment the schema moves, which is precisely when a backup matters.
 *
 * PostgREST publishes every exposed table in its OpenAPI document at the API
 * root, so that is the source of truth here. Nothing to keep in sync.
 *
 *   npx tsx scripts/backup-all.ts [label]
 */
import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'

const URL = process.env.SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const db = createClient(URL, KEY)

async function allTables(): Promise<string[]> {
  const res = await fetch(`${URL}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  if (!res.ok) throw new Error(`could not read the API schema: ${res.status}`)
  const spec = await res.json() as { definitions?: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } }
  const defs = spec.definitions ?? spec.components?.schemas ?? {}
  return Object.keys(defs).sort()
}

async function main() {
  const label = process.argv[2] ?? 'manual'
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const dir = `docs/backups/${label}-${stamp}`
  mkdirSync(dir, { recursive: true })

  const tables = await allTables()
  console.log(`${tables.length} tables exposed by the API\n`)

  let total = 0
  const manifest: Record<string, number | string> = {}
  for (const t of tables) {
    const { data, error } = await db.from(t).select('*')
    if (error) {
      manifest[t] = `ERROR: ${error.message}`
      console.log(`  !!  ${t.padEnd(28)} ${error.message.slice(0, 50)}`)
      continue
    }
    writeFileSync(`${dir}/${t}.json`, JSON.stringify(data, null, 2))
    manifest[t] = data?.length ?? 0
    total += data?.length ?? 0
    console.log(`  ok  ${t.padEnd(28)} ${data?.length ?? 0}`)
  }

  writeFileSync(`${dir}/_manifest.json`, JSON.stringify({
    takenAt: new Date().toISOString(),
    label, tableCount: tables.length, rowCount: total, tables: manifest,
  }, null, 2))

  const failed = Object.entries(manifest).filter(([, v]) => typeof v === 'string')
  console.log(`\n${total} rows across ${tables.length} tables → ${dir}`)
  if (failed.length) {
    console.log(`${failed.length} table(s) FAILED — this backup is incomplete`)
    process.exit(1)
  }
}
main()
