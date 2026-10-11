# ADR-002: Jenkins Automation Circuit Breaker Pattern
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: SRE Platform Leads  

## Context & Problem Statement
When downstream Jenkins nodes suffer infrastructure failures (e.g. cluster node crash, runner OOM), repeated autonomous recovery triggers can flood the pipeline queue, causing cascading outages across enterprise CI/CD.

## Decision Outcome
Implemented a stateful **Circuit Breaker** (`CLOSED`, `OPEN`, `HALF-OPEN`) in `remediation/recovery.js`.
- 3 consecutive remediation failures trip the breaker to `OPEN`.
- In `OPEN` state, all automatic triggers are immediately rejected with a 30-minute cooldown window.
- In `HALF-OPEN` state, a single trial run is permitted. Success resets to `CLOSED`; failure resets the 30-minute timer.

## Consequences
- **Positive**: Protects Jenkins from thunder-herd problem; alerts on-call engineers to upstream runner issues immediately.
- **Negative**: Requires manual SRE intervention or cooldown patience during major infrastructure recovery.
