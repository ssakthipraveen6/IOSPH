# Correlation Domain Pod

**Squad Owner:** `@sentinel-org/observability-ai-team`

## Responsibilities
- AI root-cause analysis and ticket cross-correlation.
- 12-track Unified Correlation Timeline for cross-infrastructure incident telemetry.
- Entity catalog drill-down, topology inspection, and global infrastructure search.

## Components
- `UnifiedCorrelationTimeline.jsx`: Multi-swimlane correlation timeline view.
- `EntityDrillDownPanel.jsx`: Slide-out deep inspection panel for individual infrastructure assets.
- `EntityExplorerView.jsx`: Catalog filter and grid view for all registered applications and hosts.
- `GlobalEntitySearch.jsx`: Global search modal (accessible via ⌘K).
- `DriftRcaCorrelationFeed.jsx`: Live stream of configuration drifts and ServiceNow incidents.
