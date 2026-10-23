-- 001_metrics.sql — raw metric points plus a 1-minute rollup.
-- {db} is substituted by scripts/clickhouse_migrate.js with the configured database.
-- Every statement ends with ';' at end of line and is idempotent.

CREATE TABLE IF NOT EXISTS {db}.metrics
(
    ts          DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    env         LowCardinality(String),
    component   LowCardinality(String),
    entity_id   String CODEC(ZSTD(1)),
    metric_name LowCardinality(String),
    value       Float64 CODEC(Gorilla, ZSTD(1)),
    source      LowCardinality(String),   -- dynatrace | otel | probe | custom | collector
    attributes  Map(LowCardinality(String), String) CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (env, component, metric_name, entity_id, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS {db}.metrics_1m
(
    ts          DateTime('UTC'),
    env         LowCardinality(String),
    component   LowCardinality(String),
    metric_name LowCardinality(String),
    entity_id   String,
    source      LowCardinality(String),
    value_min   AggregateFunction(min, Float64),
    value_max   AggregateFunction(max, Float64),
    value_avg   AggregateFunction(avg, Float64),
    value_count AggregateFunction(count, Float64),
    value_q     AggregateFunction(quantiles(0.5, 0.95), Float64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (env, component, metric_name, entity_id, source, ts)
TTL ts + INTERVAL 400 DAY DELETE;

CREATE MATERIALIZED VIEW IF NOT EXISTS {db}.metrics_1m_mv TO {db}.metrics_1m AS
SELECT
    toDateTime(toStartOfMinute(m.ts), 'UTC') AS ts,   -- qualified to avoid a cyclic alias
    env,
    component,
    metric_name,
    entity_id,
    source,
    minState(value)                    AS value_min,
    maxState(value)                    AS value_max,
    avgState(value)                    AS value_avg,
    countState(value)                  AS value_count,
    quantilesState(0.5, 0.95)(value)   AS value_q
FROM {db}.metrics AS m
GROUP BY ts, env, component, metric_name, entity_id, source;
