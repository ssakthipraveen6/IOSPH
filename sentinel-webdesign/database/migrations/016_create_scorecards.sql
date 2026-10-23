-- 016_create_scorecards.sql
-- M5 Task 5.6: Weekly Product Scorecards Table

CREATE TABLE IF NOT EXISTS product_scorecard (
    id VARCHAR(64) PRIMARY KEY,
    environment VARCHAR(32) NOT NULL DEFAULT 'production',
    week_start DATE NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    availability_pct FLOAT NOT NULL,
    p95_ms FLOAT,
    p95_change_pct FLOAT,
    change_points_count INT DEFAULT 0,
    open_cves_count INT DEFAULT 0,
    top_cause VARCHAR(64),
    html_content TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scorecard_env_product ON product_scorecard(environment, product_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_week ON product_scorecard(week_start);
