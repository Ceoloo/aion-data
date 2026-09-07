-- ============================================================================
-- Migration 0010 — IE-002 delivery statuses: activation_ready / active
-- ============================================================================
-- Extends implementation_cases.delivery_status CHECK for the activation gate.
-- Keeps IE-001 stubs (accepted, live) for backward compatibility.
-- ============================================================================

ALTER TABLE implementation_cases
  DROP CONSTRAINT IF EXISTS implementation_cases_delivery_status_check;

ALTER TABLE implementation_cases
  ADD CONSTRAINT implementation_cases_delivery_status_check
  CHECK (delivery_status IN (
    'draft',
    'intake_complete',
    'recommendation_ready',
    'blueprint_draft',
    'blueprint_approved',
    'provisioning',
    'activation_ready',
    'active',
    'accepted',
    'live',
    'on_hold',
    'declined'
  ));
