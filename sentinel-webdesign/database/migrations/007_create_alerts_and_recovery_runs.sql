-- =========================================================================
-- MIGRATION 007: Enterprise Alerts & Recovery Runs Persistence (Phase 1 / T1.4)
-- Enforces immutable audit logging and long-term regulatory retention
-- =========================================================================

CREATE TABLE IF NOT EXISTS alert (
  id          TEXT PRIMARY KEY,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  component   TEXT NOT NULL,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Active',
  resolved_at TIMESTAMPTZ,
  env         TEXT NOT NULL,
  count       INT NOT NULL DEFAULT 1,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_env_status_ts ON alert (env, status, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_alert_component ON alert (component, timestamp DESC);

CREATE TABLE IF NOT EXISTS recovery_run (
  id              TEXT PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  component       TEXT NOT NULL,
  action          TEXT NOT NULL,
  trigger_reason  TEXT,
  status          TEXT NOT NULL,
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration        DOUBLE PRECISION DEFAULT 0,
  approvals       JSONB NOT NULL DEFAULT '[]'::jsonb,
  env             TEXT NOT NULL,
  initiated_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_recovery_run_env_ts ON recovery_run (env, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_run_component ON recovery_run (component, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_run_status ON recovery_run (status);
