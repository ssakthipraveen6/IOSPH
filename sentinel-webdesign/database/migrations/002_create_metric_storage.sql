-- =========================================================================
-- MIGRATION 002: Create Metric Time-Series Storage & Rollups (Phase 2 / T2.1)
-- Supports both TimescaleDB hypertable and vanilla PostgreSQL fallback.
-- =========================================================================

CREATE TABLE IF NOT EXISTS metric (
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id   TEXT NOT NULL,
  component   TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value       DOUBLE PRECISION,
  environment TEXT NOT NULL,
  labels      JSONB
);

CREATE INDEX IF NOT EXISTS idx_metric_entity_ts ON metric (entity_id, metric_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_metric_component_ts ON metric (component, metric_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_metric_env_ts ON metric (environment, ts DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('metric', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
    
    CREATE MATERIALIZED VIEW IF NOT EXISTS metric_1m WITH (timescaledb.continuous) AS
      SELECT time_bucket('1 minute', ts) AS bucket, entity_id, component, metric_name, environment,
             avg(value) AS avg_value, max(value) AS max_value, min(value) AS min_value, count(*) AS sample_count
      FROM metric GROUP BY 1,2,3,4,5;
      
    CREATE MATERIALIZED VIEW IF NOT EXISTS metric_1h WITH (timescaledb.continuous) AS
      SELECT time_bucket('1 hour', ts) AS bucket, entity_id, component, metric_name, environment,
             avg(value) AS avg_value, max(value) AS max_value, min(value) AS min_value, count(*) AS sample_count
      FROM metric GROUP BY 1,2,3,4,5;
      
    PERFORM add_retention_policy('metric', INTERVAL '7 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('metric_1m', INTERVAL '30 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('metric_1h', INTERVAL '400 days', if_not_exists => TRUE);
    PERFORM add_compression_policy('metric', INTERVAL '2 days', if_not_exists => TRUE);
  ELSE
    -- Standard PostgreSQL fallback views with aggregation
    CREATE OR REPLACE VIEW metric_1m AS
      SELECT date_trunc('minute', ts) AS bucket, entity_id, component, metric_name, environment,
             avg(value) AS avg_value, max(value) AS max_value, min(value) AS min_value, count(*) AS sample_count
      FROM metric GROUP BY 1,2,3,4,5;
      
    CREATE OR REPLACE VIEW metric_1h AS
      SELECT date_trunc('hour', ts) AS bucket, entity_id, component, metric_name, environment,
             avg(value) AS avg_value, max(value) AS max_value, min(value) AS min_value, count(*) AS sample_count
      FROM metric GROUP BY 1,2,3,4,5;
  END IF;
END $$;
