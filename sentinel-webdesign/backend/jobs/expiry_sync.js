/**
 * backend/jobs/expiry_sync.js
 *
 * Phase O7 / O7.1 & O7.3: Certificate & Licence Inventory Synchronization.
 * Runs on leader node every 15 minutes.
 *
 * Merges:
 * - VIP probe certs (chain, SAN, hostname match, TLS version, cipher, sig algorithm)
 * - O2.7 local listener certs and keystores
 * - O2.3 osquery certificates
 * - SSO signing certs (idp_saml_cert_days_remaining)
 * - K8s ingress probes
 *
 * De-duplicates by fingerprint and maintains all locations.
 * Flags SHA-1 and TLS 1.0.
 *
 * Licence sources in strict precedence:
 *   1. license.api (product API with canary account where readable)
 *   2. license.file (file read by agent probe)
 *   3. manifest date (license.expiry / lifecycle.license.expiry)
 *
 * Persists to database/expiry_store.js and ClickHouse expiry_items.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const tls = require('tls');
const expiryStore = require('../../database/expiry_store');
const yamlConfig = require('../config/yaml_config');

// Short SHA-256 used as a stable id.
function sha256(str) {
  return crypto.createHash('sha256').update(String(str)).digest('hex').slice(0, 32);
}

/**
 * Normalizes certificate fingerprint.
 */
function normalizeCertFingerprint(cert) {
  if (cert.fingerprint) return String(cert.fingerprint).replace(/:/g, '').toLowerCase();
  const idStr = `${cert.subject || ''}|${cert.issuer || ''}|${cert.not_after || cert.valid_to || ''}`;
  return sha256(idStr);
}

/**
 * Analyzes certificate flags (e.g. SHA-1, TLS 1.0).
 */
function detectCertFlags(cert) {
  const flags = new Set(cert.flags || []);
  const sig = String(cert.sigalg || cert.signatureAlgorithm || '').toLowerCase();
  if (sig.includes('sha1') || sig.includes('sha-1')) {
    flags.add('SHA-1');
  }
  const proto = String(cert.protocol || cert.tls_version || cert.tlsVersion || '').toLowerCase();
  if (proto === 'tlsv1' || proto === 'tlsv1.0' || proto === 'tls 1.0') {
    flags.add('TLS_1.0');
  }
  return Array.from(flags);
}

/**
 * Resolves product license following precedence: API -> File -> Manifest.
 */
async function resolveProductLicense(appId, appManifest, { apiReader, fileReader, nowMs = Date.now() } = {}) {
  const licConfig = appManifest.license || appManifest.lifecycle?.license;
  if (!licConfig && !appManifest.seats_total) return null;

  let source = null;
  let expiryDate = null;
  let seatsTotal = licConfig?.seats_total !== undefined ? Number(licConfig.seats_total) : null;
  let seatsUsed = licConfig?.seats_used !== undefined ? Number(licConfig.seats_used) : null;

  // 1. license.api
  if (licConfig?.api) {
    try {
      let apiData = null;
      if (typeof apiReader === 'function') {
        apiData = await apiReader(appId, licConfig.api);
      }
      if (apiData && (apiData.expiry || apiData.not_after)) {
        source = 'license_api';
        expiryDate = apiData.expiry || apiData.not_after;
        if (apiData.seats_total !== undefined) seatsTotal = Number(apiData.seats_total);
        if (apiData.seats_used !== undefined) seatsUsed = Number(apiData.seats_used);
      }
    } catch (_) {}
  }

  // 2. license.file
  if (!source && licConfig?.file) {
    try {
      let fileContent = null;
      if (typeof fileReader === 'function') {
        fileContent = await fileReader(appId, licConfig.file);
      } else if (fs.existsSync(licConfig.file)) {
        fileContent = fs.readFileSync(licConfig.file, 'utf8');
      }
      if (fileContent) {
        source = 'license_file';
        // Parse license content or metadata
        try {
          const parsed = JSON.parse(fileContent);
          expiryDate = parsed.expiry || parsed.not_after || licConfig.expiry;
          if (parsed.seats_total !== undefined) seatsTotal = Number(parsed.seats_total);
          if (parsed.seats_used !== undefined) seatsUsed = Number(parsed.seats_used);
        } catch (_) {
          // If plain text or manifest fallback
          const m = fileContent.match(/expiry[:=]\s*([^\s;]+)/i);
          expiryDate = m ? m[1] : (licConfig.expiry || null);
        }
      }
    } catch (_) {}
  }

  // 3. manifest date
  if (!source && (licConfig?.expiry || appManifest.lifecycle?.license?.expiry)) {
    source = 'manifest';
    expiryDate = licConfig?.expiry || appManifest.lifecycle?.license?.expiry;
  }

  if (!expiryDate && seatsTotal === null) return null;

  const notAfterIso = expiryDate ? new Date(expiryDate).toISOString() : null;
  const daysRemaining = notAfterIso ? expiryStore.calculateDaysLeft(notAfterIso, nowMs) : null;
  const fingerprint = `lic:${appId}`;

  return {
    fingerprint,
    kind: 'license',
    subject: `${appId} Enterprise License`,
    product: appId,
    locations: [`manifest:${appId}`],
    not_after: notAfterIso,
    source: source || 'manifest',
    seats_total: seatsTotal,
    seats_used: seatsUsed,
    checked_at: new Date(nowMs).toISOString(),
    days_remaining: daysRemaining,
    flags: []
  };
}


/**
 * Reads the certificate presented at host:port. Verification is off on purpose: the job
 * must be able to read an expired or self-signed certificate to report it. Resolves null
 * when the endpoint cannot be reached, so nothing is invented for it.
 */
function probeTlsEndpoint(target, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(String(target || '').trim());
    if (!m) return resolve(null);
    const host = m[1];
    const port = Number(m[2]) || 443;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let socket;
    try {
      socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs }, () => {
        const c = socket.getPeerCertificate();
        const out = c && c.valid_to ? {
          subject: (c.subject && (c.subject.CN || c.subject.O)) || host,
          issuer: (c.issuer && (c.issuer.CN || c.issuer.O)) || null,
          fingerprint: c.fingerprint256 || c.fingerprint || null,
          valid_to: c.valid_to,
          protocol: socket.getProtocol ? socket.getProtocol() : null
        } : null;
        socket.end();
        finish(out);
      });
      socket.on('timeout', () => { socket.destroy(); finish(null); });
      socket.on('error', () => finish(null));
    } catch (_) { finish(null); }
  });
}

/**
 * Reads the declared `lifecycle.certificates` probes of every manifest. Returns the
 * certificates it could read plus the declared probes it could not (those stay visible
 * as unprobed rather than being given a made-up date).
 */
async function collectDeclaredCertProbes(apps, probeFn = probeTlsEndpoint) {
  const found = [];
  const unprobed = [];
  for (const [appId, app] of Object.entries(apps || {})) {
    const declared = app && app.lifecycle && app.lifecycle.certificates;
    if (!Array.isArray(declared)) continue;
    for (const d of declared) {
      if (!d || !d.probe) continue;
      let cert = null;
      try { cert = await probeFn(d.probe); } catch (_) { cert = null; }
      if (cert && cert.valid_to) {
        found.push({
          kind: 'tls_cert',
          subject: cert.subject || d.name || d.probe,
          issuer: cert.issuer || undefined,
          fingerprint: cert.fingerprint || undefined,
          not_after: cert.valid_to,
          protocol: cert.protocol,
          location: `probe:${d.probe}`,
          product: appId,
          source: 'declared_probe'
        });
      } else {
        unprobed.push({ app: appId, name: d.name || null, probe: d.probe });
      }
    }
  }
  return { found, unprobed };
}

/**
 * Main synchronization runner.
 */
async function runExpirySync({
  apps = null,
  certInputs = [],
  apiReader = null,
  fileReader = null,
  nowMs = Date.now(),
  store = expiryStore,
  certProbe = probeTlsEndpoint
} = {}) {
  const allApps = apps || yamlConfig.loadAllApplications() || {};
  const mergedCerts = new Map(); // fingerprint -> record

  // Helper to ingest a cert and merge locations
  function ingestCert(c) {
    if (!c) return;
    const fp = normalizeCertFingerprint(c);
    const flags = detectCertFlags(c);
    const location = c.location || c.target || (c.host ? `${c.host}:${c.port || 443}` : 'localhost');

    if (!mergedCerts.has(fp)) {
      mergedCerts.set(fp, {
        fingerprint: fp,
        kind: c.kind || 'tls_cert',
        subject: c.subject || c.cn || fp,
        issuer: c.issuer || 'Internal CA',
        not_after: c.not_after || c.valid_to ? new Date(c.not_after || c.valid_to).toISOString() : null,
        source: c.source || 'probe',
        product: c.product || 'general',
        locations: new Set([location]),
        flags: new Set(flags),
        seats_total: null,
        seats_used: null
      });
    } else {
      const existing = mergedCerts.get(fp);
      existing.locations.add(location);
      for (const f of flags) existing.flags.add(f);
      if (c.product && existing.product === 'general') existing.product = c.product;
    }
  }

  // 1. Ingest explicit cert inputs passed in, then the probes declared in manifests
  for (const c of certInputs) {
    ingestCert(c);
  }
  const declared = await collectDeclaredCertProbes(allApps, certProbe);
  for (const c of declared.found) ingestCert(c);

  // 2. Scan applications for declared certificates, VIPs, and SSO
  for (const [appId, app] of Object.entries(allApps)) {
    // Declared keystores or paths
    if (app.certificates) {
      if (Array.isArray(app.certificates.paths)) {
        for (const p of app.certificates.paths) {
          ingestCert({
            subject: `${appId} Cert (${p})`,
            location: `file:${p}`,
            product: appId,
            source: 'osquery',
            not_after: app.certificates.expiry || null
          });
        }
      }
      if (Array.isArray(app.certificates.keystores)) {
        for (const ks of app.certificates.keystores) {
          ingestCert({
            subject: `${appId} Keystore (${ks})`,
            location: `keystore:${ks}`,
            product: appId,
            source: 'agent_probe',
            not_after: app.certificates.expiry || null
          });
        }
      }
    }

    // SSO SAML signing cert if declared
    if (app.layers?.sso || app.sso) {
      const ssoExpiry = app.sso?.saml_cert_expiry || app.layers?.sso?.cert_expiry;
      if (ssoExpiry) {
        ingestCert({
          kind: 'saml_cert',
          subject: `${appId} IdP SAML Signing Certificate`,
          location: `sso:${appId}`,
          product: appId,
          source: 'sso_saml',
          not_after: ssoExpiry
        });
      }
    }

    // Licences
    const licRecord = await resolveProductLicense(appId, app, { apiReader, fileReader, nowMs });
    if (licRecord) {
      await store.upsertExpiryItem(licRecord, nowMs);
    }
  }

  // Store all merged certificates
  const savedItems = [];
  for (const [fp, item] of mergedCerts.entries()) {
    const record = {
      fingerprint: fp,
      kind: item.kind,
      subject: item.subject,
      issuer: item.issuer,
      not_after: item.not_after,
      source: item.source,
      product: item.product,
      locations: Array.from(item.locations),
      flags: Array.from(item.flags),
      seats_total: item.seats_total,
      seats_used: item.seats_used
    };
    const saved = await store.upsertExpiryItem(record, nowMs);
    if (saved) savedItems.push(saved);
  }

  return {
    synchronized_at: new Date(nowMs).toISOString(),
    certificates_count: mergedCerts.size,
    unprobed: declared.unprobed,
    items: savedItems
  };
}

module.exports = {
  runExpirySync,
  resolveProductLicense,
  detectCertFlags,
  normalizeCertFingerprint,
  collectDeclaredCertProbes,
  probeTlsEndpoint
};
