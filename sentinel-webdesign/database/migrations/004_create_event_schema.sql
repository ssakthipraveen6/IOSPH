-- =========================================================================
-- MIGRATION 004: Normalized Event Store & RCA Hypotheses (Phase 4 / T4.1)
-- Supports Graph Fan-Out, Causal Timeline, and Operator Feedback Loop
-- =========================================================================

CREATE TABLE IF NOT EXISTS event (
  event_id    TEXT PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id   TEXT,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  payload     JSONB,
  environment TEXT NOT NULL,
  source      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_ts ON event (ts DESC);
CREATE INDEX IF NOT EXISTS idx_event_entity_ts ON event (entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_event_kind_env_ts ON event (kind, environment, ts DESC);

CREATE TABLE IF NOT EXISTS rca_hypothesis (
  hypothesis_id     TEXT PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_event_id  TEXT NOT NULL,
  suspect_entity_id TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL,
  blast_radius      INT NOT NULL,
  rationale         JSONB NOT NULL,
  environment       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open',
  verdicts          JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_rca_hypothesis_env_status ON rca_hypothesis (environment, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rca_hypothesis_suspect ON rca_hypothesis (suspect_entity_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('event', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM add_compression_policy('event', INTERVAL '2 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('event', INTERVAL '30 days', if_not_exists => TRUE);
  END IF;
END $$;
