-- =========================================================================
-- REVERSE MIGRATION 002: Drop Metric Storage & Views (Phase 2 / T2.1)
-- =========================================================================

DROP VIEW IF EXISTS metric_1h CASCADE;
DROP VIEW IF EXISTS metric_1m CASCADE;
DROP MATERIALIZED VIEW IF EXISTS metric_1h CASCADE;
DROP MATERIALIZED VIEW IF EXISTS metric_1m CASCADE;
DROP TABLE IF EXISTS metric CASCADE;
