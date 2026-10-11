# ADR-001: CyberArk CCP Dynamic Credential Retrieval
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: DevSecOps Architecture, Enterprise IAM  

## Context & Problem Statement
In accordance with BFSI information security standards, plaintext credentials must never be stored in repository files, environment variables (`.env`), or disk configurations on Windows servers.

## Decision Outcome
Adopted **CyberArk Central Credential Provider (CCP)** as the single source of truth for runtime credentials. At server initialization, `backend/auth/session.js` calls CyberArk via mutual TLS to retrieve JWT secrets and database connection strings into volatile RAM.

## Consequences
- **Positive**: 100% compliant with PCI-DSS Req 8; automated key rotation without deployment.
- **Negative**: Adds startup network dependency on CyberArk CCP availability (mitigated via cached in-memory session lifetime).
