-- 015_create_problems.sql
-- M5 Task 5.4: Problem Grouping Schema

CREATE TABLE IF NOT EXISTS problem (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    environment VARCHAR(32) NOT NULL DEFAULT 'production',
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    severity VARCHAR(32) NOT NULL DEFAULT 'CRITICAL',
    top_layer VARCHAR(64),
    confidence FLOAT DEFAULT 0.0,
    suspect_entity VARCHAR(255),
    alert_count INT DEFAULT 1,
    evidence_pack JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_problem_env_status ON problem(environment, status);
CREATE INDEX IF NOT EXISTS idx_problem_suspect ON problem(suspect_entity);
