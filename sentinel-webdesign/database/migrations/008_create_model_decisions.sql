-- =========================================================================
-- MIGRATION 008: AI Statistical Anomaly Model Decisions (Phase 2 / P2-01)
-- Provides explainable AI auditing for model predictions & baseline deviations
-- =========================================================================

CREATE TABLE IF NOT EXISTS model_decision (
  decision_id   TEXT PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version TEXT NOT NULL,
  component     TEXT NOT NULL,
  metric_name   TEXT NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  mean          DOUBLE PRECISION NOT NULL,
  stddev        DOUBLE PRECISION NOT NULL,
  z_score       DOUBLE PRECISION NOT NULL,
  threshold     DOUBLE PRECISION NOT NULL,
  decision      TEXT NOT NULL,
  environment   TEXT NOT NULL DEFAULT 'staging'
);

CREATE INDEX IF NOT EXISTS idx_model_decision_comp_ts ON model_decision (component, metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_model_decision_env_ts ON model_decision (environment, timestamp DESC);
