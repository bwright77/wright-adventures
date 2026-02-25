/**
 * Creates an OMP admin user via the Supabase Admin API.
 *
 * Usage:
 *   SUPABASE_URL=https://your-project-ref.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
 *   ADMIN_EMAIL=ben@wrightadventures.org \
 *   node scripts/create-admin-user.mjs
 *
 * The secret key is in Supabase → Settings → API → secret key (previously "service_role").
 * Never commit it or put it in .env.local.
 */

const url            = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const email          = process.env.ADMIN_EMAIL

if (!url || !serviceRoleKey || !email) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL')
  process.exit(1)
}

const headers = {
  'Content-Type':  'application/json',
  'apikey':        serviceRoleKey,
  'Authorization': `Bearer ${serviceRoleKey}`,
}

// 0. Preflight: verify the migration has been run (profiles table must exist)
console.log('\nChecking database setup…')
const checkRes = await fetch(`${url}/rest/v1/profiles?limit=1`, { headers })
if (!checkRes.ok) {
  console.error('\n✗ Could not reach the profiles table.')
  console.error('  Run the migration first:')
  console.error('  Supabase dashboard → SQL Editor → paste and run:')
  console.error('  supabase/migrations/20260224000000_initial_schema.sql\n')
  process.exit(1)
}
console.log('✓ Database ready')

// Random 20-char password: letters + digits + symbols
const chars    = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
const password = Array.from({ length: 20 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

// 1. Create the auth user
console.log(`\nCreating user: ${email}`)
const createRes = await fetch(`${url}/auth/v1/admin/users`, {
  method:  'POST',
  headers,
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
  }),
})

const createData = await createRes.json()

if (!createRes.ok) {
  if (createData.msg?.includes('Database error')) {
    console.error('\n✗ Trigger failure — the profiles table exists but the handle_new_user')
    console.error('  trigger could not insert into it. Try re-running the migration to')
    console.error('  recreate the trigger, then run this script again.\n')
  } else {
    console.error('\n✗ Failed to create user:', JSON.stringify(createData, null, 2))
  }
  process.exit(1)
}

const userId = createData.id
console.log(`✓ Auth user created (id: ${userId})`)

// 2. Upsert profile — trigger may have already created the row; set role=admin regardless
const fullName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

const upsertRes = await fetch(`${url}/rest/v1/profiles`, {
  method:  'POST',
  headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ id: userId, full_name: fullName, role: 'admin' }),
})

if (!upsertRes.ok) {
  const err = await upsertRes.text()
  console.error('\n✗ Failed to set profile:', err)
  process.exit(1)
}

console.log('✓ Profile set to admin')
console.log('\n─────────────────────────────────')
console.log('  Admin user ready')
console.log('─────────────────────────────────')
console.log(`  Email:    ${email}`)
console.log(`  Password: ${password}`)
console.log('─────────────────────────────────')
console.log('\nSave this password — it will not be shown again.\n')
