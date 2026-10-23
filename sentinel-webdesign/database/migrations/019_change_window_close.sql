-- 019_change_window_close.sql
-- Phase S1: change windows can be closed early (who and when), and new rows default
-- to the prod/staging vocabulary instead of 'production'.
ALTER TABLE change_window ADD COLUMN IF NOT EXISTS closed_by VARCHAR(128);
ALTER TABLE change_window ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE change_window ALTER COLUMN environment SET DEFAULT 'staging';
UPDATE change_window SET environment = 'prod' WHERE environment = 'production';
UPDATE change_window SET environment = 'staging' WHERE environment IN ('stg', 'stage');
