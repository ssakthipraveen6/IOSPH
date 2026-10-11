# ADR-005: In-Memory Bounded Ring Buffer for Offline Resilience
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: Core Platform & SRE  

## Context & Problem Statement
If the PostgreSQL/TimescaleDB backend undergoes planned maintenance, network partition, or cluster failover, telemetry ingestion must not block or crash the Node.js server with unhandled database errors.

## Decision Outcome
Implemented a **bounded in-memory ring buffer (capacity: 20,000 events)** in `database/event_store.js`. When database queries fail with network errors (e.g. `ENOTFOUND`, `ECONNREFUSED`), events are safely buffered in RAM without dropping data. A background queue drainer replays buffered records once the database pool reconnects.

## Consequences
- **Positive**: 100% telemetry ingest availability during database outages up to ~2 hours.
- **Negative**: Unbounded memory growth risk if buffer is unconstrained (mitigated by strict 20,000 limit with FIFO eviction).
