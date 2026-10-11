# ADR-003: Streaming Z-Score Statistical Anomaly Engine
**Status**: Accepted  
**Date**: October 2026  
**Deciders**: Observability Guild & SRE  

## Context & Problem Statement
Detecting subtle performance degradation before hard static threshold breaches occur requires anomaly detection. Heavy ML models (e.g. LSTM, Prophet, Transformer) introduce high CPU overhead and cold-start latency when running on lightweight Windows edge servers.

## Decision Outcome
Implemented a continuous, streaming **$Z$-Score anomaly engine** (`ai_analysis/real_analyzer.js`) utilizing a sliding 60-datapoint baseline window:
$$Z = \frac{x - \mu}{\sigma}$$
Points where $|Z| \ge 3.0\sigma$ ($99.7\%$ confidence interval) are classified as statistical anomalies and stored in PostgreSQL `model_decision` table.

## Consequences
- **Positive**: Sub-millisecond calculation time; zero external ML runtime dependencies (e.g. PyTorch / ONNX); transparent explainability for auditors.
- **Negative**: Less effective on bi-modal distributions without cyclical seasonal smoothing.
