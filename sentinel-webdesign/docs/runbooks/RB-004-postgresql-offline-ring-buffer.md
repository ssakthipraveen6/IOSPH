# RB-004: PostgreSQL Connectivity Loss & Ring Buffer Overflow
**Document ID**: RB-004  
**Severity**: P1 - Critical (Storage Degradation)  
**Target RTO**: < 10 Minutes  
**Owning Team**: Core Platform & DBA Team

---

## 1. Symptoms & Detection
- Server log: `[EVENT_STORE] PostgreSQL event insert failed. Cached in ring buffer.`
- Ring buffer utilization metric exceeds 80% (16,000 / 20,000 events).
- Risk of data loss if buffer capacity (20,000 items) is exceeded.

---

## 2. Immediate Triage
1. Check PostgreSQL database host availability:
   ```powershell
   Test-NetConnection -ComputerName "db-prod-primary.internal.corp" -Port 5432
   ```
2. Check database connection pool state:
   - Login to PostgreSQL replica/primary:
     ```sql
     SELECT count(*), state FROM pg_stat_activity GROUP BY state;
     ```
   - Check if `max_connections` (usually 100 or 200) was hit.

---

## 3. Resolution Steps
1. **If Database Process Down**:
   - Restart the PostgreSQL service or initiate primary failover to hot standby:
     ```bash
     sudo systemctl restart postgresql-16
     ```
2. **If Network Partition / DNS Issue**:
   - Verify `/etc/hosts` or Windows `hosts` file DNS resolution for `db-prod-primary.internal.corp`.
3. **Drain & Flush Ring Buffer**:
   - Sentinel's `event_store.js` automatically retries flushing buffered events on the next query or via the background drain worker.
   - Trigger manual sync via SRE panel or service reload.
