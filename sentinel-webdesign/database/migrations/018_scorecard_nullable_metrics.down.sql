-- 018_scorecard_nullable_metrics.down.sql
UPDATE product_scorecard SET availability_pct = 0 WHERE availability_pct IS NULL;
ALTER TABLE product_scorecard ALTER COLUMN availability_pct SET NOT NULL;
ALTER TABLE product_scorecard ALTER COLUMN change_points_count SET DEFAULT 0;
ALTER TABLE product_scorecard ALTER COLUMN open_cves_count SET DEFAULT 0;
ALTER TABLE problem ALTER COLUMN confidence SET DEFAULT 0.0;
ALTER TABLE problem ALTER COLUMN environment SET DEFAULT 'production';
ALTER TABLE product_scorecard ALTER COLUMN environment SET DEFAULT 'production';
