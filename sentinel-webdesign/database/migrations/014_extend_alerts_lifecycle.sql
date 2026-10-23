-- 014_extend_alerts_lifecycle.sql
-- M5 Task 5.3: Alert Lifecycle (rule_id, acked_by, snoozed_until, resolved_by)

ALTER TABLE alert ADD COLUMN IF NOT EXISTS rule_id VARCHAR(64);
ALTER TABLE alert ADD COLUMN IF NOT EXISTS acked_by VARCHAR(128);
ALTER TABLE alert ADD COLUMN IF NOT EXISTS acked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP WITH TIME ZONE;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(128);
ALTER TABLE alert ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE alert ADD COLUMN IF NOT EXISTS problem_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_alert_status_env ON alert(status, env);
CREATE INDEX IF NOT EXISTS idx_alert_problem_id ON alert(problem_id);
