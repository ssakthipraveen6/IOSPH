-- 007_baselines.sql
-- M5 Task 5.1: Hour-of-Week Baselines (Median and MAD)

CREATE TABLE IF NOT EXISTS {db}.baselines
(
    env          LowCardinality(String),
    entity_id    String CODEC(ZSTD(1)),
    metric_name  LowCardinality(String),
    hour_of_week UInt16,
    median       Float64,
    mad          Float64,
    sample_count UInt32,
    updated_at   DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (env, entity_id, metric_name, hour_of_week)
SETTINGS index_granularity = 8192;
