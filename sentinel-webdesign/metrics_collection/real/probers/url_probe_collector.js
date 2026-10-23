/**
 * metrics_collection/real/probers/url_probe_collector.js
 *
 * Generic URL-Only Prober Collector for unowned systems without agents or APIs (T5.5 / C6).
 * Measures real latency, verifies HTTP status code, inspects TLS validity,
 * and performs optional content assertions (e.g. for Aquasec, external portals).
 */

const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const os = require('os');
const { URL } = require('url');

// Cache of latest VIP probe results per environment
const lastVipProbeResults = new Map();

/**
 * Probes a single URL target with high precision latency measurement and TLS checks.
 */
function probeUrl(targetConfig) {
  return new Promise((resolve) => {
    const {
      url: targetUrl,
      component = 'url_target',
      expectedStatus = 200,
      contentAssertion = null,
      timeoutMs = 4000
    } = targetConfig;

    if (!targetUrl) {
      return resolve({
        component,
        url: null,
        status: 'DATA_UNAVAILABLE',
        error: 'Target URL is required',
        latencyMs: null
      });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `Invalid URL: ${e.message}`,
        latencyMs: null
      });
    }

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const startHr = process.hrtime.bigint();

    const req = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'Sentinel-Unified-Prober/2.0 (HealthCheck)'
        }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          if (body.length < 32768) {
            body += chunk;
          }
        });

        res.on('end', () => {
          const endHr = process.hrtime.bigint();
          const latencyMs = Number((endHr - startHr) / 1000000n);

          let tlsValid = null;
          let tlsExpiresAt = null;

          if (isHttps && res.socket && res.socket.getPeerCertificate) {
            try {
              const cert = res.socket.getPeerCertificate();
              if (cert && cert.valid_to) {
                tlsExpiresAt = new Date(cert.valid_to).toISOString();
                tlsValid = new Date(cert.valid_to).getTime() > Date.now();
              }
            } catch (_) {}
          }

          const httpStatus = res.statusCode;
          const statusMatches = Array.isArray(expectedStatus)
            ? expectedStatus.includes(httpStatus)
            : httpStatus === expectedStatus;

          let assertionPassed = true;
          if (contentAssertion) {
            assertionPassed = typeof contentAssertion === 'string'
              ? body.includes(contentAssertion)
              : Boolean(contentAssertion.test && contentAssertion.test(body));
          }

          let status = 'HEALTHY';
          if (!statusMatches) {
            status = httpStatus >= 500 ? 'CRITICAL' : 'DEGRADED';
          } else if (!assertionPassed) {
            status = 'DEGRADED';
          }

          resolve({
            component,
            url: targetUrl,
            status,
            httpStatus,
            latencyMs,
            tlsValid,
            tlsExpiresAt,
            assertionPassed,
            timestamp: new Date().toISOString()
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      const endHr = process.hrtime.bigint();
      const latencyMs = Number((endHr - startHr) / 1000000n);
      resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `Probe timed out after ${timeoutMs}ms`,
        latencyMs,
        timestamp: new Date().toISOString()
      });
    });

    req.on('error', (err) => {
      const endHr = process.hrtime.bigint();
      const latencyMs = Number((endHr - startHr) / 1000000n);
      resolve({
        component,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: err.message,
        latencyMs,
        timestamp: new Date().toISOString()
      });
    });

    req.end();
  });
}

/**
 * Runs batch URL probes across multiple target configs and emits standardized metrics.
 */
async function collectUrlProbes(targets = [], db = null, env = 'staging') {
  const results = [];
  const metricsBatch = [];

  for (const target of targets) {
    const res = await probeUrl(target);
    results.push(res);

    if (res.latencyMs !== null) {
      metricsBatch.push({
        component: res.component,
        metricName: 'probe_latency_ms',
        value: res.latencyMs,
        timestamp: res.timestamp,
        env
      });
    }

    if (res.httpStatus !== undefined) {
      metricsBatch.push({
        component: res.component,
        metricName: 'http_status_code',
        value: res.httpStatus,
        timestamp: res.timestamp,
        env
      });
    }
  }

  if (db && metricsBatch.length > 0 && typeof db.addMetricBatch === 'function') {
    db.addMetricBatch(metricsBatch, env);
  }

  return results;
}

// [Q4] Discovery fields attached to every probeVip result (null = not observed).
const EMPTY_DISCOVERY = Object.freeze({ dns_addresses: null, dns_cnames: null, cert_cn: null, cert_sans: null });
const MAX_DNS_ANSWERS = 32;
const MAX_CERT_SANS = 100;
const MAX_CNAME_HOPS = 8;
const CNAME_TIMEOUT_MS = 1000;

/** "DNS:a.example, IP Address:10.0.0.1, DNS:*.b.example" -> ['a.example', '*.b.example'] (DNS entries only). */
function parseSanDnsNames(subjectaltname) {
  if (typeof subjectaltname !== 'string' || !subjectaltname) return [];
  const out = new Set();
  for (const part of subjectaltname.split(',')) {
    const m = part.trim().match(/^DNS:(.+)$/i);
    if (m && m[1].trim()) out.add(m[1].trim().toLowerCase());
    if (out.size >= MAX_CERT_SANS) break;
  }
  return Array.from(out);
}

/**
 * Follows the CNAME chain for hostname. Best effort: bounded hops and a short overall
 * timeout; any error or no CNAME returns [] (the name is an A/AAAA record itself).
 */
function resolveCnameChain(hostname) {
  const walk = async () => {
    const chain = [];
    let name = hostname;
    for (let i = 0; i < MAX_CNAME_HOPS; i++) {
      let next;
      try { next = await dns.promises.resolveCname(name); } catch (_) { break; }
      if (!Array.isArray(next) || next.length === 0) break;
      const target = String(next[0]).toLowerCase();
      if (chain.includes(target) || target === hostname) break;
      chain.push(target);
      name = target;
    }
    return chain;
  };
  let timer = null;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), CNAME_TIMEOUT_MS); if (timer.unref) timer.unref(); });
  return Promise.race([walk().catch(() => null), timeout]).finally(() => clearTimeout(timer));
}

/**
 * M3 Task 3.1: High-precision VIP probe measuring individual network layers:
 * DNS lookup, TCP connect, TLS handshake, TTFB, and total duration.
 * Unreachable host returns status: 'DATA_UNAVAILABLE' and null timings (never 0).
 */
function probeVip(targetConfig = {}) {
  return new Promise(async (resolve) => {
    const {
      url: targetUrl,
      productId = null,
      component = productId ? `${productId}_vip` : 'vip',
      expectedStatus = 200,
      timeoutMs = 5000,
      probeNode = process.env.SENTINEL_NODE_NAME || os.hostname()
    } = targetConfig;

    if (!targetUrl) {
      return resolve({
        component,
        productId,
        url: null,
        status: 'DATA_UNAVAILABLE',
        error: 'Target URL is required',
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString(),
        ...EMPTY_DISCOVERY
      });
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (e) {
      return resolve({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `Invalid URL: ${e.message}`,
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString(),
        ...EMPTY_DISCOVERY
      });
    }

    const isHttps = parsed.protocol === 'https:';
    const hostname = parsed.hostname;
    const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80);
    const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '');

    let netSocket = null;
    let tlsSocket = null;
    let isSettled = false;
    // [Q4] What the probe observed on the way (DNS answers, certificate names),
    // consumed by inventory/sources/vip_discovery.js. null = not observed.
    const discovery = { ...EMPTY_DISCOVERY };

    const cleanup = () => {
      if (netSocket && !netSocket.destroyed) {
        try { netSocket.destroy(); } catch (_) {}
      }
      if (tlsSocket && !tlsSocket.destroyed) {
        try { tlsSocket.destroy(); } catch (_) {}
      }
    };

    const timeoutTimer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      resolve({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `VIP probe timed out after ${timeoutMs}ms`,
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString(),
        ...discovery
      });
    }, timeoutMs);

    const finish = (result) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutTimer);
      cleanup();
      resolve({ ...result, ...discovery });
    };

    const totalStart = process.hrtime.bigint();

    // [Q4] CNAME chain, best effort, in parallel and outside the dns_ms timing.
    const cnamePromise = net.isIP(hostname) ? Promise.resolve(null) : resolveCnameChain(hostname);

    // 1. DNS Timing
    let resolvedIp = null;
    let dns_ms = null;
    try {
      const dnsStart = process.hrtime.bigint();
      // [Q4] all:true costs the same single getaddrinfo call and returns every answer.
      const answers = await dns.promises.lookup(hostname, { all: true });
      const dnsEnd = process.hrtime.bigint();
      if (!Array.isArray(answers) || answers.length === 0) throw new Error('no addresses returned');
      resolvedIp = answers[0].address;
      discovery.dns_addresses = Array.from(new Set(answers.map(a => a.address))).slice(0, MAX_DNS_ANSWERS);
      dns_ms = Math.max(0.01, parseFloat((Number(dnsEnd - dnsStart) / 1e6).toFixed(2)));
    } catch (dnsErr) {
      return finish({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `DNS lookup failed: ${dnsErr.message}`,
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString()
      });
    }

    // 2. TCP Connect Timing
    let tcp_ms = null;
    try {
      const tcpStart = process.hrtime.bigint();
      await new Promise((resolveTcp, rejectTcp) => {
        netSocket = net.createConnection({ host: resolvedIp, port }, () => {
          const tcpEnd = process.hrtime.bigint();
          tcp_ms = Math.max(0.01, parseFloat((Number(tcpEnd - tcpStart) / 1e6).toFixed(2)));
          resolveTcp();
        });
        netSocket.once('error', rejectTcp);
      });
    } catch (tcpErr) {
      return finish({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `TCP connect failed: ${tcpErr.message}`,
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString()
      });
    }

    // 3. TLS Handshake Timing (if HTTPS)
    let tls_ms = null;
    let cert_days_left = null;
    let cert_subject = null;
    let cert_issuer = null;
    let protocol = isHttps ? null : 'HTTP/1.1';
    let cipher = null;
    let activeSocket = netSocket;

    if (isHttps) {
      try {
        const tlsStart = process.hrtime.bigint();
        tlsSocket = await new Promise((resolveTls, rejectTls) => {
          const s = tls.connect({
            socket: netSocket,
            servername: net.isIP(hostname) ? undefined : hostname,
            rejectUnauthorized: false
          }, () => {
            const tlsEnd = process.hrtime.bigint();
            tls_ms = Math.max(0.01, parseFloat((Number(tlsEnd - tlsStart) / 1e6).toFixed(2)));
            resolveTls(s);
          });
          s.once('error', rejectTls);
        });
        activeSocket = tlsSocket;

        protocol = typeof tlsSocket.getProtocol === 'function' ? tlsSocket.getProtocol() : 'TLS';
        const cipherObj = typeof tlsSocket.getCipher === 'function' ? tlsSocket.getCipher() : null;
        cipher = cipherObj ? (cipherObj.name || String(cipherObj)) : null;

        if (typeof tlsSocket.getPeerCertificate === 'function') {
          const cert = tlsSocket.getPeerCertificate();
          if (cert && typeof cert === 'object') {
            discovery.cert_cn = cert.subject && typeof cert.subject.CN === 'string' ? cert.subject.CN : null;
            discovery.cert_sans = parseSanDnsNames(cert.subjectaltname);
          }
          if (cert && cert.valid_to) {
            cert_subject = cert.subject;
            cert_issuer = cert.issuer;
            const validToEpoch = new Date(cert.valid_to).getTime();
            cert_days_left = Math.max(0, Math.floor((validToEpoch - Date.now()) / (1000 * 60 * 60 * 24)));
          }
        }
      } catch (tlsErr) {
        return finish({
          component,
          productId,
          url: targetUrl,
          status: 'DATA_UNAVAILABLE',
          error: `TLS handshake failed: ${tlsErr.message}`,
          httpStatus: null,
          dns_ms: null,
          tcp_ms: null,
          tls_ms: null,
          ttfb_ms: null,
          total_ms: null,
          cert_days_left: null,
          cert_subject: null,
          cert_issuer: null,
          protocol: null,
          cipher: null,
          probe_node: probeNode,
          source: 'probe',
          timestamp: new Date().toISOString()
        });
      }
    }

    // 4. TTFB and Total Duration via HTTP GET
    let ttfb_ms = null;
    let total_ms = null;
    let httpStatus = null;
    let rawBody = '';

    try {
      await new Promise((resolveHttp, rejectHttp) => {
        const ttfbStart = process.hrtime.bigint();
        let firstByteReceived = false;

        activeSocket.on('data', (chunk) => {
          if (!firstByteReceived) {
            firstByteReceived = true;
            const ttfbEnd = process.hrtime.bigint();
            ttfb_ms = Math.max(0.01, parseFloat((Number(ttfbEnd - ttfbStart) / 1e6).toFixed(2)));
            const str = chunk.toString('utf8');
            const m = str.match(/^HTTP\/[0-9.]+\s+(\d{3})/i);
            if (m) {
              httpStatus = Number(m[1]);
            }
          }
          if (rawBody.length < 32768) {
            rawBody += chunk.toString('utf8');
          }
        });

        activeSocket.once('end', () => {
          const totalEnd = process.hrtime.bigint();
          total_ms = Math.max(0.01, parseFloat((Number(totalEnd - totalStart) / 1e6).toFixed(2)));
          resolveHttp();
        });

        activeSocket.once('close', () => {
          if (total_ms === null) {
            const totalEnd = process.hrtime.bigint();
            total_ms = Math.max(0.01, parseFloat((Number(totalEnd - totalStart) / 1e6).toFixed(2)));
          }
          resolveHttp();
        });

        activeSocket.once('error', rejectHttp);

        activeSocket.write(
          `GET ${pathAndQuery} HTTP/1.1\r\n` +
          `Host: ${hostname}\r\n` +
          `User-Agent: Sentinel-VIP-Prober/2.0\r\n` +
          `Accept: */*\r\n` +
          `Connection: close\r\n\r\n`
        );
      });
    } catch (httpErr) {
      return finish({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: `HTTP request failed: ${httpErr.message}`,
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString()
      });
    }

    if (httpStatus === null) {
      return finish({
        component,
        productId,
        url: targetUrl,
        status: 'DATA_UNAVAILABLE',
        error: 'No valid HTTP status line received',
        httpStatus: null,
        dns_ms: null,
        tcp_ms: null,
        tls_ms: null,
        ttfb_ms: null,
        total_ms: null,
        cert_days_left: null,
        cert_subject: null,
        cert_issuer: null,
        protocol: null,
        cipher: null,
        probe_node: probeNode,
        source: 'probe',
        timestamp: new Date().toISOString()
      });
    }

    discovery.dns_cnames = await cnamePromise;

    const statusMatches = Array.isArray(expectedStatus)
      ? expectedStatus.includes(httpStatus)
      : httpStatus === expectedStatus;

    let probeStatus = 'HEALTHY';
    if (!statusMatches) {
      probeStatus = httpStatus >= 500 ? 'CRITICAL' : 'DEGRADED';
    }

    return finish({
      component,
      productId,
      url: targetUrl,
      status: probeStatus,
      httpStatus,
      dns_ms,
      tcp_ms,
      tls_ms,
      ttfb_ms,
      total_ms,
      cert_days_left,
      cert_subject,
      cert_issuer,
      protocol,
      cipher,
      probe_node: probeNode,
      source: 'probe',
      timestamp: new Date().toISOString()
    });
  });
}

/**
 * Runs batch VIP probes across configured targets and emits standardized metrics.
 */
async function collectVipProbes(targets = [], db = null, env = 'staging') {
  const results = [];
  const metricsBatch = [];

  for (const target of targets) {
    const res = await probeVip(target);
    results.push(res);

    if (res.status !== 'DATA_UNAVAILABLE') {
      const probeNode = res.probe_node || process.env.SENTINEL_NODE_NAME || os.hostname();
      const entityId = target.productId ? `app:${target.productId}` : (target.component ? `vip:${target.component}` : `vip:${res.url}`);

      const addMetricItem = (metricName, val) => {
        if (val !== null && val !== undefined) {
          metricsBatch.push({
            component: target.productId || target.component || 'vip',
            entity_id: entityId,
            metricName,
            value: typeof val === 'number' ? val : 0,
            timestamp: res.timestamp,
            env,
            source: 'probe',
            attributes: {
              probe_node: probeNode,
              target_url: res.url,
              product: target.productId || ''
            }
          });
        }
      };

      addMetricItem('vip.dns_ms', res.dns_ms);
      addMetricItem('vip.tcp_ms', res.tcp_ms);
      if (res.tls_ms !== null) addMetricItem('vip.tls_ms', res.tls_ms);
      addMetricItem('vip.ttfb_ms', res.ttfb_ms);
      addMetricItem('vip.total_ms', res.total_ms);
      if (res.cert_days_left !== null) addMetricItem('vip.cert_days_left', res.cert_days_left);
      addMetricItem('vip.status', res.status === 'HEALTHY' ? 1 : (res.status === 'DEGRADED' ? 2 : 0));
    }
  }

  // Cache latest results for API consumers
  lastVipProbeResults.set(env, results);

  if (db && metricsBatch.length > 0) {
    if (typeof db.addMetricBatch === 'function') {
      db.addMetricBatch(metricsBatch, env);
    } else if (typeof db.addMetric === 'function') {
      for (const m of metricsBatch) {
        db.addMetric(m.component, m.metricName, m.value, env, m.entity_id, 'probe');
      }
    }
  }

  return results;
}

// Last VIP probe results.
function getLastVipProbes(env = 'staging') {
  return lastVipProbeResults.get(env) || [];
}

module.exports = {
  probeUrl,
  collectUrlProbes,
  probeVip,
  collectVipProbes,
  getLastVipProbes,
  parseSanDnsNames
};
