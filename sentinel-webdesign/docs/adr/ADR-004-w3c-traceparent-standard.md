# ADR-004: W3C Trace Context Standard for Distributed Tracing
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: Enterprise Telemetry Working Group  

## Context & Problem Statement
Tracing alerts from raw telemetry ingestion through AI root-cause correlation and down to Jenkins remediation previously relied on ad-hoc proprietary ID headers (`X-Request-Id`), preventing cross-platform trace correlation in enterprise APM tools (Dynatrace, Jaeger).

## Decision Outcome
Standardized on the **W3C `traceparent` recommendation** (`00-{trace_id}-{span_id}-{trace_flags}`). Implemented a dedicated middleware (`backend/tracing.js`) that extracts or injects W3C headers on every HTTP and WebSocket frame, persisting the `trace_id` into all audit records and RCA hypotheses.

## Consequences
- **Positive**: Native interoperability with OpenTelemetry collectors, Dynatrace PurePath, and external distributed tracing platforms.
- **Negative**: Adds minor byte overhead to log records and network headers.
