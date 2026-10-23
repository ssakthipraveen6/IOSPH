-- 018_scorecard_nullable_metrics.sql
-- Phase P8: a scorecard field with no data is stored as NULL ("not available"), never 0.

ALTER TABLE product_scorecard ALTER COLUMN availability_pct DROP NOT NULL;
ALTER TABLE product_scorecard ALTER COLUMN change_points_count DROP DEFAULT;
ALTER TABLE product_scorecard ALTER COLUMN open_cves_count DROP DEFAULT;
ALTER TABLE problem ALTER COLUMN confidence DROP DEFAULT;
ALTER TABLE problem ALTER COLUMN environment SET DEFAULT 'staging';
ALTER TABLE product_scorecard ALTER COLUMN environment SET DEFAULT 'staging';
