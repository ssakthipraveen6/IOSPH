-- 006_cve_findings.sql
-- M4 Task 4.8: Security Vulnerability and Package CVE Findings

CREATE TABLE IF NOT EXISTS {db}.cve_findings
(
    ts           DateTime64(3, 'UTC') CODEC(Delta, ZSTD(1)),
    env          LowCardinality(String),
    host         String CODEC(ZSTD(1)),
    product_id   LowCardinality(String),
    package_name String CODEC(ZSTD(1)),
    version      String CODEC(ZSTD(1)),
    cve_id       String CODEC(ZSTD(1)),
    severity     LowCardinality(String),
    cvss_score   Float64,
    description  String CODEC(ZSTD(2)),
    remediation  String CODEC(ZSTD(1)),
    is_eol       UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (env, severity, cve_id, host)
TTL toDateTime(ts) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
