// =============================================================================
// drop-board-transcripts-bucket.mjs
//
// Companion to 20260818000000_decommission_grants.sql (ADR-009 Phase 5).
//
// Supabase blocks direct DML on storage.objects / storage.buckets:
//   ERROR: Direct deletion from storage tables is not allowed. (SQLSTATE 42501)
// Since the migration runs in a transaction, doing it in SQL rolls back the
// whole decommission. So the bucket is removed here instead, after the
// migration has applied.
//
//   node --env-file=.env.local scripts/drop-board-transcripts-bucket.mjs
//
// Idempotent: a missing bucket is reported and treated as success.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

const BUCKET = 'board-meeting-transcripts'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(url, key)

const { data: buckets, error: listErr } = await db.storage.listBuckets()
if (listErr) {
  console.error('Could not list buckets:', listErr.message)
  process.exit(1)
}

if (!buckets.some(b => b.name === BUCKET)) {
  console.log(`Bucket "${BUCKET}" not present — nothing to do.`)
  process.exit(0)
}

// Refuse to delete a bucket that still holds objects: that would destroy files
// the table dump did not capture.
const { data: objects, error: objErr } = await db.storage.from(BUCKET).list('', { limit: 1000 })
if (objErr) {
  console.error('Could not list objects:', objErr.message)
  process.exit(1)
}
if (objects.length > 0) {
  console.error(`Bucket "${BUCKET}" still holds ${objects.length} object(s). Back them up and empty it first.`)
  process.exit(1)
}

const { error: emptyErr } = await db.storage.emptyBucket(BUCKET)
if (emptyErr) console.warn('emptyBucket warning:', emptyErr.message)

const { error: delErr } = await db.storage.deleteBucket(BUCKET)
if (delErr) {
  console.error('Failed to delete bucket:', delErr.message)
  process.exit(1)
}

console.log(`Bucket "${BUCKET}" deleted.`)
