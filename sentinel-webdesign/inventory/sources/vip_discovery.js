/**
 * inventory/sources/vip_discovery.js — Phase Q4
 *
 * Turns what the P1 VIP probe observed (backend/jobs/vip_probes.js ->
 * metrics_collection/real/probers/url_probe_collector.js probeVip) into topology:
 *
 *   vip:<hostname> --resolves_to--> ip:<env>:<address>      (kind 'ip_address')
 *   vip:<hostname> --cert_san-->    dns_name:<env>:<name>    (kind 'dns_name')
 *
 * Plus labels on the VIP entity: dns_cnames (CNAME chain) and cert_cn.
 *
 * Rules:
 *  - Environment is the probe run's environment; there is no default. A call
 *    without a valid environment is refused (never tagged 'production').
 *  - Discovered entity ids carry the environment, because a manifest `layers.vip`
 *    is shared by every environment and the two runs must not overwrite each
 *    other's answers.
 *  - Replace-on-refresh: each probe result replaces the previous set of this
 *    VIP's discovered edges for that environment; stale ones are removed and a
 *    discovered entity left with no edges is removed too. A set is only
 *    replaced when the probe actually observed it (dns_addresses / cert_sans are
 *    arrays); null means "not observed this time" and leaves the previous set.
 *  - Bounded: at most MAX_SANS_PER_VIP SAN names and MAX_ADDRESSES_PER_VIP
 *    addresses per VIP.
 *  - No outbound calls: this only records what the probe already saw.
 */

const defaultStore = require('../store');

const SOURCE = 'vip_probe';
const EDGE_RESOLVES_TO = 'resolves_to';
const EDGE_CERT_SAN = 'cert_san';
const KIND_IP = 'ip_address';
const KIND_DNS_NAME = 'dns_name';
const MAX_SANS_PER_VIP = 50;
const MAX_ADDRESSES_PER_VIP = 32;
const VALID_ENVS = new Set(['prod', 'staging', 'demo']);

// Safe id fragment.
function sanitizeIdPart(str) {
  return String(str).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

// Normalises an environment name.
function normalizeEnv(env) {
  const e = String(env || '').trim().toLowerCase();
  if (e === 'production' || e === 'prd') return 'prod';
  if (e === 'stg' || e === 'stage') return 'staging';
  return VALID_ENVS.has(e) ? e : null;
}

// Entity id of an IP address.
const ipEntityId = (env, address) => `ip:${env}:${sanitizeIdPart(address)}`;
// Entity id of a DNS name.
const dnsNameEntityId = (env, name) => `dns_name:${env}:${sanitizeIdPart(name)}`;
/** Same convention as yaml_source.js: `vip:${new URL(vip).hostname}`. */
const vipEntityId = (hostname) => `vip:${hostname}`;

// Unique strings, capped.
function uniqueStrings(list, cap, lower = false) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    if (typeof v !== 'string') continue;
    const s = lower ? v.trim().toLowerCase() : v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

// Creates or updates a VIP entity from a probe.
async function ensureVipEntity(store, vipId, hostname, result, env) {
  const existing = await store.getEntityById(vipId);
  const labels = { discovery_at: result.timestamp || new Date().toISOString() };
  if (result.probe_node) labels.discovery_probe_node = result.probe_node;
  if (Array.isArray(result.dns_cnames)) labels.dns_cnames = result.dns_cnames.slice(0, 8);
  if (result.cert_cn !== undefined && result.cert_cn !== null) labels.cert_cn = result.cert_cn;

  if (existing) {
    // Keep the manifest-owned fields; only refresh the discovery labels.
    const { edges: _edges, ...base } = existing;
    await store.upsertEntity({ ...base, labels });
    return;
  }
  await store.upsertEntity({
    entity_id: vipId,
    kind: 'vip',
    name: `VIP: ${hostname}`,
    app_id: result.productId || null,
    environment: env,
    labels: { url: result.url, layer: 'network', ...labels },
    source: SOURCE,
    status: 'Active'
  });
  if (result.productId) {
    await store.upsertEdge({ from_entity: vipId, to_entity: `app:${result.productId}`, edge_type: 'routes_traffic_to', confidence: 1.0, source: SOURCE });
  }
}

/**
 * Makes the VIP's `edgeType` edges into entities with id prefix `prefix` equal to
 * `desired` (Map id -> entity), removing the rest. Returns { added, removed }.
 */
async function replaceEdgeSet(store, vipId, edgeType, prefix, desired) {
  const vip = await store.getEntityById(vipId);
  const current = (vip?.edges?.outgoing || [])
    .filter(e => e.edge_type === edgeType && e.to_entity.startsWith(prefix))
    .map(e => e.to_entity);

  let removed = 0;
  for (const toId of current) {
    if (desired.has(toId)) continue;
    await store.removeEdge(vipId, toId, edgeType);
    removed++;
    const target = await store.getEntityById(toId);
    if (target && target.source === SOURCE
      && target.edges.incoming.length === 0 && target.edges.outgoing.length === 0) {
      await store.removeEntity(toId);
    }
  }

  let added = 0;
  for (const [toId, entity] of desired) {
    await store.upsertEntity(entity);
    await store.upsertEdge({ from_entity: vipId, to_entity: toId, edge_type: edgeType, confidence: 1.0, source: SOURCE });
    added++;
  }
  return { added, removed };
}

/**
 * Records one environment's probe results. Signature matches the vip_probes
 * job's onResults(env, results) hook.
 */
async function recordVipDiscovery(env, results, { store = defaultStore } = {}) {
  const environment = normalizeEnv(env);
  if (!environment) throw new Error(`vip_discovery: invalid environment '${env}'`);
  if (typeof store.removeEdge !== 'function' || typeof store.removeEntity !== 'function') {
    throw new Error('vip_discovery: store does not support edge removal');
  }

  const summary = { environment, vips: 0, addresses: 0, sans: 0, removed: 0, sans_truncated: 0 };
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || !result.url) continue;
    let parsed;
    try { parsed = new URL(result.url); } catch (_) { continue; }
    const hostname = parsed.hostname;
    if (!hostname) continue;

    const observedDns = Array.isArray(result.dns_addresses);
    // A plain-http VIP presents no certificate: its SAN set is authoritatively empty.
    const observedSans = Array.isArray(result.cert_sans) || parsed.protocol === 'http:';
    const observedLabels = Array.isArray(result.dns_cnames) || (result.cert_cn !== undefined && result.cert_cn !== null);
    if (!observedDns && !observedSans && !observedLabels) continue;

    const vipId = vipEntityId(hostname);
    await ensureVipEntity(store, vipId, hostname, result, environment);
    summary.vips++;

    if (observedDns) {
      const addresses = uniqueStrings(result.dns_addresses, MAX_ADDRESSES_PER_VIP, true);
      const desired = new Map();
      for (const addr of addresses) {
        const id = ipEntityId(environment, addr);
        desired.set(id, {
          entity_id: id, kind: KIND_IP, name: addr, environment,
          labels: { family: addr.includes(':') ? 6 : 4 }, source: SOURCE, status: 'Active'
        });
      }
      const r = await replaceEdgeSet(store, vipId, EDGE_RESOLVES_TO, `ip:${environment}:`, desired);
      summary.addresses += r.added;
      summary.removed += r.removed;
    }

    if (observedSans) {
      const all = uniqueStrings(Array.isArray(result.cert_sans) ? result.cert_sans : [], Number.MAX_SAFE_INTEGER, true);
      const sans = all.slice(0, MAX_SANS_PER_VIP);
      summary.sans_truncated += all.length - sans.length;
      const desired = new Map();
      for (const name of sans) {
        const id = dnsNameEntityId(environment, name);
        desired.set(id, {
          entity_id: id, kind: KIND_DNS_NAME, name, environment,
          labels: { wildcard: name.startsWith('*.') }, source: SOURCE, status: 'Active'
        });
      }
      const r = await replaceEdgeSet(store, vipId, EDGE_CERT_SAN, `dns_name:${environment}:`, desired);
      summary.sans += r.added;
      summary.removed += r.removed;
    }
  }
  return summary;
}

module.exports = {
  recordVipDiscovery,
  SOURCE,
  EDGE_RESOLVES_TO,
  EDGE_CERT_SAN,
  KIND_IP,
  KIND_DNS_NAME,
  MAX_SANS_PER_VIP,
  MAX_ADDRESSES_PER_VIP
};
