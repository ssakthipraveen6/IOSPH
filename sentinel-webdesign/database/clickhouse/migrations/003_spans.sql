-- 003_spans.sql — SENTINEL-native span table (synthetic journeys now, traces later).
-- Written by database/clickhouse.js insertSpans(), and fed from otel_traces by 004.

CREATE TABLE IF NOT EXISTS {db}.spans
(
    trace_id       String CODEC(ZSTD(1)),
    span_id        String CODEC(ZSTD(1)),
    parent_span_id String CODEC(ZSTD(1)),
    name           LowCardinality(String),
    service        LowCardinality(String),
    env            LowCardinality(String),
    start_ts       DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    duration_ms    Float64,
    status         LowCardinality(String),
    attributes     Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(start_ts)
ORDER BY (env, service, name, start_ts)
TTL toDateTime(start_ts) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
