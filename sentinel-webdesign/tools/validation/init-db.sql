-- Initialize metrics and audit schema for validation harness
CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  component TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value DOUBLE PRECISION,
  environment TEXT NOT NULL DEFAULT 'staging'
);

CREATE INDEX IF NOT EXISTS idx_metrics_comp_name_env_ts ON metrics(component, metric_name, environment, timestamp DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  ip TEXT NOT NULL,
  details JSONB
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  dept TEXT,
  last_login TIMESTAMPTZ,
  mfa BOOLEAN DEFAULT TRUE,
  permissions JSONB DEFAULT '["read"]'::jsonb
);

CREATE TABLE IF NOT EXISTS sso_log (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username TEXT NOT NULL,
  email TEXT,
  role TEXT,
  provider TEXT,
  ldap_dn TEXT,
  ip TEXT,
  session_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_revocation (
  jti TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT
);
