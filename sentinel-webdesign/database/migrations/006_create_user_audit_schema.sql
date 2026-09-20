-- Migration 006: Users, audit events and SSO login events (T0.9 / T0.16)
-- Moves identity and the change-audit trail off the local JSON file and onto
-- an append-only relational store that an auditor can query.

CREATE TABLE IF NOT EXISTS app_user (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'Active',
  dept        TEXT,
  mfa         BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]',
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email ON app_user (lower(email));

-- Append-only: no UPDATE or DELETE is ever issued against this table.
CREATE TABLE IF NOT EXISTS audit_event (
  event_id    BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor       TEXT NOT NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  user_agent  TEXT,
  http_path   TEXT,
  http_method TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_event_ts ON audit_event (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_actor ON audit_event (actor, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_action ON audit_event (action, ts DESC);

CREATE TABLE IF NOT EXISTS sso_login_event (
  event_id  BIGSERIAL PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
  username  TEXT NOT NULL,
  email     TEXT,
  role      TEXT,
  provider  TEXT,
  ldap_dn   TEXT,
  ip        TEXT,
  status    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sso_login_event_ts ON sso_login_event (ts DESC);
