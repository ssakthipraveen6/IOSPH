-- =========================================================================
-- MIGRATION 003: Create Log Event Storage & FTS Indexing (Phase 3 / T3.4)
-- Supports PostgreSQL Full-Text Search (GIN tsvector) & TimescaleDB
-- =========================================================================

CREATE TABLE IF NOT EXISTS log_event (
  id          BIGSERIAL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id   TEXT,
  app_id      TEXT,
  environment TEXT NOT NULL,
  level       TEXT,
  logger      TEXT,
  message     TEXT NOT NULL,
  fields      JSONB,
  fingerprint TEXT,
  PRIMARY KEY (ts, id)
);

-- Performance & Query Optimization Indexes
CREATE INDEX IF NOT EXISTS idx_log_event_ts_brin ON log_event USING brin(ts);
CREATE INDEX IF NOT EXISTS idx_log_event_app_level_ts ON log_event (app_id, level, ts DESC);
CREATE INDEX IF NOT EXISTS idx_log_event_env_ts ON log_event (environment, ts DESC);
CREATE INDEX IF NOT EXISTS idx_log_event_fingerprint_ts ON log_event (fingerprint, ts DESC);

-- PostgreSQL Full-Text Search (GIN index on simple dictionary)
CREATE INDEX IF NOT EXISTS idx_log_event_fts ON log_event USING gin(to_tsvector('simple', message));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('log_event', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM add_compression_policy('log_event', INTERVAL '2 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('log_event', INTERVAL '14 days', if_not_exists => TRUE);
  END IF;
END $$;
