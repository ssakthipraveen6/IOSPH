-- 008_expiry_items.sql
-- Phase O7: Certificate & Licence Inventory with Multi-location aggregation

CREATE TABLE IF NOT EXISTS {db}.expiry_items
(
    fingerprint    String CODEC(ZSTD(1)),
    kind           LowCardinality(String),
    subject        String CODEC(ZSTD(1)),
    locations      Array(String),
    not_after      DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    source         LowCardinality(String),
    product        LowCardinality(String),
    seats_total    Nullable(UInt32),
    seats_used     Nullable(UInt32),
    checked_at     DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    days_remaining Int32,
    status         LowCardinality(String),
    flags          Array(String),
    INDEX idx_product product TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(checked_at)
ORDER BY (product, kind, fingerprint)
SETTINGS index_granularity = 8192;
