-- 012_add_gateway_allowed_environments.sql
-- Add allowed_environments to ingest_api_key for gateway scope routing across environments.

ALTER TABLE ingest_api_key ADD COLUMN IF NOT EXISTS allowed_environments TEXT[];
