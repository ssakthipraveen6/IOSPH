-- M1.5: API keys for telemetry ingest (OTel gateway, agents, Jenkins/GitHub cron jobs).
-- Only a SHA-256 hash of each key is stored. The environment is bound to the key,
-- so an agent cannot choose which environment its data lands in.
CREATE TABLE IF NOT EXISTS ingest_api_key (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  environment   TEXT NOT NULL CHECK (environment IN ('prod', 'staging', 'demo')),
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['metrics', 'logs', 'heartbeat'],
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);
