-- 002_logs.sql — log records ingested via OTLP /v1/logs and the log collectors.

CREATE TABLE IF NOT EXISTS {db}.logs
(
    ts        DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    env       LowCardinality(String),
    app_id    LowCardinality(String),
    entity_id String CODEC(ZSTD(1)),
    level     LowCardinality(String),
    message   String CODEC(ZSTD(3)),
    trace_id  String CODEC(ZSTD(1)),
    fields    Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_message  lower(message) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (env, app_id, level, ts)
TTL toDateTime(ts) + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
