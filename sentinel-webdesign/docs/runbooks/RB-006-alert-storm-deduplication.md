# RB-006: Alert Storm & Deduplication Tuning
**Document ID**: RB-006  
**Severity**: P2 - High (Operator Fatigue)  
**Target RTO**: < 20 Minutes  
**Owning Team**: NOC / Telemetry Operations

---

## 1. Symptoms & Detection
- NOC consoles flooded with hundreds of alerts for the same underlying component failure.
- Notification webhooks (Slack/Teams/ServiceNow) experiencing rate limit throttling.
- Memory consumption rising due to high alert volume.

---

## 2. Investigation
1. Verify the 5-minute deduplication window in `database/db.js`:
   - Duplicate alerts with identical `(component, severity, message)` within 300 seconds must increment `occurrence_count` rather than pushing a new record.
2. Check if messages contain dynamic timestamps or UUIDs preventing exact deduplication match:
   ```bash
   curl -s http://127.0.0.1:3001/api/alerts?env=prod | jq '.[0:10]'
   ```

---

## 3. Mitigation & Resolution
1. **Silence / Suppress Target Component**:
   - In `global_config.yaml`, temporarily disable the noisy scraper or component:
     ```yaml
     applications_enabled:
       noisy_component: false
     ```
   - Reload YAML configuration live via `POST /api/yaml/reload`.
2. **Normalize Alert Template**:
   - Strip dynamic microsecond timestamps or random IDs from the alert generator string so the hash deduplicator catches subsequent occurrences.
