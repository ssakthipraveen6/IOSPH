CREATE TABLE IF NOT EXISTS change_window (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    environment VARCHAR(32) NOT NULL DEFAULT 'production',
    product_id VARCHAR(64),
    host VARCHAR(255),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_change_window_env_time ON change_window(environment, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_change_window_product ON change_window(product_id);
