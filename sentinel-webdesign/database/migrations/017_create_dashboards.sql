-- 017_create_dashboards.sql
-- M7 Task 7.2: Custom and system dashboard definitions with SentinelQL panels

CREATE TABLE IF NOT EXISTS dashboards (
    id VARCHAR(64) PRIMARY KEY,
    slug VARCHAR(128) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    tags JSONB DEFAULT '[]'::jsonb,
    panels JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(128) NOT NULL DEFAULT 'system',
    environment VARCHAR(32) NOT NULL DEFAULT 'production'
);

CREATE INDEX IF NOT EXISTS idx_dashboards_slug ON dashboards(slug);
CREATE INDEX IF NOT EXISTS idx_dashboards_env ON dashboards(environment);
