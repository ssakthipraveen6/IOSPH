-- =========================================================================
-- MIGRATION 009: Immutable Audit Events & 7-Year Retention (Phase 3 / P3-04)
-- Satisfies RBI IT Framework §6 & PCI-DSS Req 10 for tamper-proof audit trails
-- =========================================================================

ALTER TABLE audit_event ADD COLUMN IF NOT EXISTS trace_id TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_event_trace_id ON audit_event (trace_id);

CREATE TABLE IF NOT EXISTS audit_event_archive (
  event_id    BIGINT PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL,
  actor       TEXT NOT NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      JSONB NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  http_path   TEXT,
  http_method TEXT,
  trace_id    TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_archive_ts ON audit_event_archive (ts DESC);
