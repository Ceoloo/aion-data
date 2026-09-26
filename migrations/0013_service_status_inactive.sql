-- ============================================================================
-- Migration 0013 — services.status gains 'inactive'
-- ============================================================================
-- Mirrors @aion/core SERVICE_STATUSES = ['active', 'inactive', 'deprecated'].
-- `inactive` = reserved / not operable (Secure Automation appointment-write
-- stubs, SA-STD-001). Additive: widens the CHECK, never narrows it.
-- ============================================================================

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_status_check;

ALTER TABLE services
  ADD CONSTRAINT services_status_check
  CHECK (status IN ('active', 'inactive', 'deprecated'));
