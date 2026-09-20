-- Migration 005: Create Expiry Item Schema (Phase 5 / T5.4)

CREATE TABLE IF NOT EXISTS expiry_item (
  item_id       TEXT PRIMARY KEY,
  entity_id     TEXT,
  kind          TEXT NOT NULL,   -- tls_cert | license | refweb_url | cyberark_object | k8s_sa_token
  name          TEXT,
  target        TEXT NOT NULL,
  issuer        TEXT,
  not_after     TIMESTAMPTZ,
  last_checked  TIMESTAMPTZ,
  last_error    TEXT,
  warning_days  INT NOT NULL DEFAULT 30,
  critical_days INT NOT NULL DEFAULT 7,
  auto_renew    TEXT
);

CREATE INDEX IF NOT EXISTS idx_expiry_item_not_after ON expiry_item (not_after);
CREATE INDEX IF NOT EXISTS idx_expiry_item_entity_id ON expiry_item (entity_id);
