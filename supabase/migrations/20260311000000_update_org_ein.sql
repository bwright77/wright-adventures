-- Update Confluence Colorado EIN in the active org profile
UPDATE org_profiles
SET
  profile_json = jsonb_set(profile_json, '{ein}', '"88-1757678"'),
  updated_at   = now()
WHERE org_name = 'Confluence Colorado'
  AND is_active = true;
