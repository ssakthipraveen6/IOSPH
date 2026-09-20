-- =========================================================================
-- REVERSE MIGRATION 004: Drop Event Store & RCA Hypotheses (Phase 4 / T4.1)
-- =========================================================================

DROP INDEX IF EXISTS idx_rca_hypothesis_suspect;
DROP INDEX IF EXISTS idx_rca_hypothesis_env_status;
DROP TABLE IF EXISTS rca_hypothesis CASCADE;

DROP INDEX IF EXISTS idx_event_kind_env_ts;
DROP INDEX IF EXISTS idx_event_entity_ts;
DROP INDEX IF EXISTS idx_event_ts;
DROP TABLE IF EXISTS event CASCADE;
