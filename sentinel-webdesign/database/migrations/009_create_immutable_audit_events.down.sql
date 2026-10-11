DROP TABLE IF EXISTS audit_event_archive CASCADE;
ALTER TABLE audit_event DROP COLUMN IF EXISTS trace_id;
