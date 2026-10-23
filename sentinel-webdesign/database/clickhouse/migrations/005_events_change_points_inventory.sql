-- 005_events_change_points_inventory.sql — events, change points, agent inventory, and 1h metric rollup.
-- {db} is substituted by scripts/clickhouse_migrate.js with the configured database.

CREATE TABLE IF NOT EXISTS {db}.events
(
    ts        DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    env       LowCardinality(String),
    entity_id String CODEC(ZSTD(1)),
    kind      LowCardinality(String),
    severity  LowCardinality(String),
    title     String CODEC(ZSTD(1)),
    payload   String CODEC(ZSTD(1)),
    source    LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (env, kind, ts, entity_id)
TTL toDateTime(ts) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS {db}.change_points
(
    ts            DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    env           LowCardinality(String),
    entity_id     String CODEC(ZSTD(1)),
    series        LowCardinality(String),
    direction     LowCardinality(String),
    magnitude_pct Float64,
    before        Float64,
    after         Float64,
    method        LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (env, entity_id, series, ts)
TTL toDateTime(ts) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS {db}.agent_inventory
(
    host          String,
    env           LowCardinality(String),
    agent_version LowCardinality(String),
    os            LowCardinality(String),
    last_seen     DateTime64(3, 'UTC'),
    config_hash   String
)
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY (env, host)
TTL toDateTime(last_seen) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS {db}.metrics_1h
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

CREATE MATERIALIZED VIEW IF NOT EXISTS {db}.metrics_1h_mv TO {db}.metrics_1h AS
SELECT
    toDateTime(toStartOfHour(m.ts), 'UTC') AS ts,
    env,
    component,
    metric_name,
    entity_id,
    source,
    minMergeState(value_min)              AS value_min,
    maxMergeState(value_max)              AS value_max,
    avgMergeState(value_avg)              AS value_avg,
    countMergeState(value_count)          AS value_count,
    quantilesMergeState(0.5, 0.95)(value_q) AS value_q
FROM {db}.metrics_1m AS m
GROUP BY ts, env, component, metric_name, entity_id, source;
