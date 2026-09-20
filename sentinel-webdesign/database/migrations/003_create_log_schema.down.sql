-- =========================================================================
-- REVERSE MIGRATION 003: Drop Log Event Storage (Phase 3 / T3.4)
-- =========================================================================

DROP INDEX IF EXISTS idx_log_event_fts;
DROP INDEX IF EXISTS idx_log_event_fingerprint_ts;
DROP INDEX IF EXISTS idx_log_event_env_ts;
DROP INDEX IF EXISTS idx_log_event_app_level_ts;
DROP INDEX IF EXISTS idx_log_event_ts_brin;
DROP TABLE IF EXISTS log_event CASCADE;
