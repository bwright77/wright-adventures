-- =============================================================================
-- Migration: 20260228000000_notifications.sql
-- Phase 2 — Email Notifications
-- ADR Reference: ADR-003-email-notifications.md
-- Author: Benjamin Wright, Director of Technology & Innovation
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Notification preferences per user
--    Defaults all notification types to enabled; users can opt out per type.
-- -----------------------------------------------------------------------------

CREATE TABLE notification_preferences (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  deadline_7d             BOOLEAN NOT NULL DEFAULT true,
  deadline_3d             BOOLEAN NOT NULL DEFAULT true,
  deadline_1d             BOOLEAN NOT NULL DEFAULT true,
  task_assigned           BOOLEAN NOT NULL DEFAULT true,
  opportunity_discovered  BOOLEAN NOT NULL DEFAULT true,  -- admin only; ignored for non-admins
  updated_at              TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  notification_preferences IS 'Per-user notification opt-in/opt-out settings. One row per user, created on first login or settings visit.';
COMMENT ON COLUMN notification_preferences.opportunity_discovered IS 'Only meaningful for users with role=admin; ignored for non-admins in notification dispatch.';

-- Auto-update updated_at on change
CREATE TRIGGER notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users read and write only their own row
CREATE POLICY "Users manage their own notification preferences"
  ON notification_preferences
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role has full access (for upsert during notification dispatch)
CREATE POLICY "Service role full access to notification_preferences"
  ON notification_preferences
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. Notification audit log
--    Append-only record of every notification attempt and outcome.
-- -----------------------------------------------------------------------------

CREATE TABLE notification_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'deadline_7d', 'deadline_3d', 'deadline_1d',
    'task_assigned',
    'opportunity_discovered'
  )),
  opportunity_id    UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  task_id           UUID REFERENCES tasks(id) ON DELETE SET NULL,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_date         DATE NOT NULL DEFAULT CURRENT_DATE,  -- UTC date; used for dedup index (TIMESTAMPTZ::date is not IMMUTABLE)
  success           BOOLEAN NOT NULL,
  error_message     TEXT,
  email_to          TEXT NOT NULL
);

COMMENT ON TABLE notification_log IS 'Audit trail for all notification dispatch attempts. Written by service role only. Used for dedup and monitoring.';
COMMENT ON COLUMN notification_log.sent_date IS 'UTC calendar date of this notification attempt. Stored explicitly because TIMESTAMPTZ::date is not IMMUTABLE and cannot be used in a partial index expression.';

-- Dedup index: prevent sending the same deadline notification twice on the same UTC day.
-- One successful send per (opportunity_id, notification_type) per calendar day.
-- Uses sent_date (plain DATE) instead of (sent_at::date) to satisfy PostgreSQL IMMUTABLE requirement.
CREATE UNIQUE INDEX notification_dedup_idx
  ON notification_log (opportunity_id, notification_type, sent_date)
  WHERE notification_type IN ('deadline_7d', 'deadline_3d', 'deadline_1d')
    AND success = true;

-- Index for monitoring queries
CREATE INDEX notification_log_user_sent_idx ON notification_log (user_id, sent_at DESC);
CREATE INDEX notification_log_type_sent_idx ON notification_log (notification_type, sent_at DESC);

-- RLS
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all log entries
CREATE POLICY "Admins read notification log"
  ON notification_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- No user writes — service role only
CREATE POLICY "Service role full access to notification_log"
  ON notification_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
