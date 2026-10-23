-- 004_otel_traces.sql — landing table for the otelcol-contrib `clickhouse` exporter.
--
-- The contrib exporter does NOT write our `spans` schema: it inserts its own
-- column set (Timestamp, TraceId, SpanId, ..., Duration in nanoseconds, Events/Links
-- Nested columns). The gateway therefore runs with create_schema: false and
-- traces_table_name: otel_traces, this table mirrors the exporter's schema
-- (otelcol-contrib v0.10x-v0.11x), and a materialized view copies each span
-- into `spans` in SENTINEL's shape.
--
-- If you upgrade otelcol-contrib and its exporter schema changes, either adjust
-- this table or set create_schema: true in the gateway config and re-create the
-- view below against the exporter-created table. The traces pipeline is optional;
-- nothing in SENTINEL depends on it yet.

CREATE TABLE IF NOT EXISTS {db}.otel_traces
(
    Timestamp          DateTime64(9) CODEC(Delta, ZSTD(1)),
    TraceId            String CODEC(ZSTD(1)),
    SpanId             String CODEC(ZSTD(1)),
    ParentSpanId       String CODEC(ZSTD(1)),
    TraceState         String CODEC(ZSTD(1)),
    SpanName           LowCardinality(String) CODEC(ZSTD(1)),
    SpanKind           LowCardinality(String) CODEC(ZSTD(1)),
    ServiceName        LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeName          String CODEC(ZSTD(1)),
    ScopeVersion       String CODEC(ZSTD(1)),
    SpanAttributes     Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    Duration           UInt64 CODEC(ZSTD(1)),
    StatusCode         LowCardinality(String) CODEC(ZSTD(1)),
    StatusMessage      String CODEC(ZSTD(1)),
    Events Nested (
        Timestamp  DateTime64(9),
        Name       LowCardinality(String),
        Attributes Map(LowCardinality(String), String)
    ),
    Links Nested (
        TraceId    String,
        SpanId     String,
        TraceState String,
        Attributes Map(LowCardinality(String), String)
    ),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDateTime(Timestamp) + INTERVAL 7 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- env is taken from the agent's resource attributes and normalised to
-- prod | staging | demo the same way backend/config/config.js does. A span
-- without an environment attribute lands with env = '' (never guessed).
CREATE MATERIALIZED VIEW IF NOT EXISTS {db}.otel_traces_to_spans_mv TO {db}.spans AS
WITH lower(coalesce(
        nullIf(ResourceAttributes['sentinel.env'], ''),
        nullIf(ResourceAttributes['deployment.environment.name'], ''),
        nullIf(ResourceAttributes['deployment.environment'], ''),
        nullIf(ResourceAttributes['environment'], ''),
        '')) AS raw_env
SELECT
    TraceId                                     AS trace_id,
    SpanId                                      AS span_id,
    ParentSpanId                                AS parent_span_id,
    SpanName                                    AS name,
    ServiceName                                 AS service,
    multiIf(raw_env IN ('prod', 'production', 'prd'), 'prod',
            raw_env IN ('staging', 'stg', 'stage'), 'staging',
            raw_env)                            AS env,
    toDateTime64(Timestamp, 3, 'UTC')           AS start_ts,
    Duration / 1e6                              AS duration_ms,
    StatusCode                                  AS status,
    mapUpdate(ResourceAttributes, SpanAttributes) AS attributes
FROM {db}.otel_traces;
