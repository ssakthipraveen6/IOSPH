# ADR-006: ServiceNow Table API Integration for Autonomous Remediation
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: Enterprise ITSM Governance & SRE  

## Context & Problem Statement
Autonomous self-healing actions modifying production infrastructure must adhere to enterprise ITIL change management guidelines and be auditable by NOC operators and problem managers.

## Decision Outcome
Integrated Sentinel's recovery pipeline directly with the **ServiceNow REST Table API** (`remediation/integrations/servicenow_client.js`).
1. When recovery initiates, an Incident (`INC-XXXXX`) is automatically created with urgency mapped to environment (`prod` = P1, `staging` = P2).
2. The current on-call engineer resolved via `teamRotaService` is assigned as the incident owner.
3. Upon completion, the incident is updated with execution duration and automatically resolved.

## Consequences
- **Positive**: Complete compliance with enterprise ITSM governance; real-time visibility for non-Sentinel NOC users.
- **Negative**: Adds external dependency on ServiceNow availability (buffered asynchronously in Sentinel database).
