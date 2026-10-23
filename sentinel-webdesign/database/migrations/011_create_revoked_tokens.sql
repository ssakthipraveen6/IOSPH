-- M1.10: token revocations shared by both SENTINEL nodes (was a local JSON file per node).
CREATE TABLE IF NOT EXISTS revoked_token (
  jti         TEXT PRIMARY KEY,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_revoked_token_revoked_at ON revoked_token (revoked_at DESC);
