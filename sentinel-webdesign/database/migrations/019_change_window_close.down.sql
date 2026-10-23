ALTER TABLE change_window ALTER COLUMN environment SET DEFAULT 'production';
ALTER TABLE change_window DROP COLUMN IF EXISTS closed_at;
ALTER TABLE change_window DROP COLUMN IF EXISTS closed_by;
