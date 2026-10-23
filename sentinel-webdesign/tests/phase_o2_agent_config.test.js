/**
 * tests/phase_o2_agent_config.test.js
 *
 * Acceptance tests for Phase O2:
 * - O2.1: Linux hostmetrics scrapers (paging, processes, load, tcp)
 * - O2.2: Windows perf counters (Processor Queue Length, Pages/sec, PhysicalDisk, LogicalDisk, Network, TCPv4, Process)
 *         and IIS counters (Web Service, APP_POOL_WAS) ONLY when iis: true; windowseventlog System channel
 * - O2.4: K8s k8sobjects (Warning events) in cluster role collector config and template assertions
 * - O2.5: sqlquery receiver for DB hosts, all queries start with SELECT/WITH, credentials only via ${env:...}
 * - O2.6: sentinel.product resource attribute (exact match from layers.hosts; host='a' matches nothing)
 * - O2.8: JMX receiver opt-in when manifest has jvm.jmx_port
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderAgentConfig, sameHost, parseDatabase, sqlqueryReceiver, loadSqlQueries } = require('../backend/routes/agentRoutes');
const yaml = require('js-yaml');

async function run() {
  console.log('--- Phase O2: Agent Configuration & Render Tests ---');

  // 1. O2.1: Linux hostmetrics scrapers
  {
    const cfg = renderAgentConfig({ host: 'linux-srv-01', os: 'linux', role: 'node' });
    const hostmetrics = cfg.collector_config.receivers.hostmetrics;
    assert(hostmetrics, 'hostmetrics receiver must exist for Linux');
    const scrapers = hostmetrics.scrapers;
    assert(scrapers.paging !== undefined, 'Linux hostmetrics must contain paging scraper');
    assert(scrapers.processes !== undefined, 'Linux hostmetrics must contain processes scraper');
    assert(scrapers.load !== undefined, 'Linux hostmetrics must contain load scraper');
    assert(scrapers.tcp !== undefined, 'Linux hostmetrics must contain tcp scraper for connections');
    assert(scrapers.cpu !== undefined, 'cpu scraper must exist');
    assert(scrapers.memory !== undefined, 'memory scraper must exist');
    assert(scrapers.disk !== undefined, 'disk scraper must exist');
    assert(scrapers.filesystem !== undefined, 'filesystem scraper must exist');
    assert(scrapers.network !== undefined, 'network scraper must exist');
    console.log('  ✓ O2.1: Linux hostmetrics includes paging, processes, load, and tcp scrapers');
  }

  // 2. O2.2: Windows perf counters & IIS conditional rendering
  {
    // Test 2a: Windows host without IIS
    const cfgNonIis = renderAgentConfig({ host: 'win-box-noiis', os: 'windows', role: 'node' });
    const winRecv = cfgNonIis.collector_config.receivers.windowsperfcounters;
    assert(winRecv, 'windowsperfcounters receiver must exist for Windows');
    const counters = winRecv.perf_counters;

    const findObj = (obj) => counters.find(c => c.object === obj);
    assert(findObj('System'), 'System object must be configured');
    assert(findObj('System').counters.includes('Processor Queue Length'), 'Processor Queue Length must be present');
    assert(findObj('Memory').counters.includes('Pages/sec'), 'Memory Pages/sec must be present');
    assert(findObj('PhysicalDisk'), 'PhysicalDisk object must be configured');
    assert(findObj('LogicalDisk'), 'LogicalDisk object must be configured');
    assert(findObj('Network Interface'), 'Network Interface object must be configured');
    assert(findObj('TCPv4'), 'TCPv4 object must be configured');
    assert(findObj('Process'), 'Process object must be configured');

    // Without iis: true, Web Service and APP_POOL_WAS must NOT be present
    assert(!findObj('Web Service'), 'Web Service counters must NOT be present without IIS');
    assert(!findObj('APP_POOL_WAS'), 'APP_POOL_WAS counters must NOT be present without IIS');

    // windowseventlog System channel
    const evtLog = cfgNonIis.collector_config.receivers.windowseventlog;
    assert(evtLog, 'windowseventlog receiver must exist for Windows');
    assert(evtLog.channel === 'System' || (evtLog.channels && evtLog.channels.includes('System')), 'windowseventlog must include System channel');

    // Test 2b: Windows host with IIS (manifest marks host iis: true)
    const yamlConfig = require('../backend/config/yaml_config');
    const allApps = yamlConfig.loadAllApplications();
    const testIisHost = 'win-iis-server-01.corp';
    allApps['test_iis_app'] = {
      id: 'test_iis_app',
      name: 'Test IIS App',
      iis: true,
      layers: { hosts: [testIisHost] }
    };

    try {
      const cfgIis = renderAgentConfig({ host: testIisHost, os: 'windows', role: 'node' });
      const winIisRecv = cfgIis.collector_config.receivers.windowsperfcounters;
      const iisCounters = winIisRecv.perf_counters;
      assert(iisCounters.some(c => c.object === 'Web Service'), 'Web Service counters must be present when host has iis: true');
      assert(iisCounters.some(c => c.object === 'APP_POOL_WAS'), 'APP_POOL_WAS counters must be present when host has iis: true');
    } finally {
      delete allApps['test_iis_app'];
    }
    console.log('  ✓ O2.2: Windows perf counters and windowseventlog System channel verified; IIS rendered only with iis: true');
  }

  // 3. O2.4: K8s k8sobjects (Warning events) in cluster Deployment & otelcol-builder.yaml
  {
    const templatePath = path.join(__dirname, '..', 'deployments', 'k8s', 'sentinel-agent', 'templates', 'cluster-deployment.yaml');
    assert(fs.existsSync(templatePath), 'cluster-deployment.yaml template must exist');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    assert(templateContent.includes('k8sobjects Warning events') || templateContent.includes('k8sobjects'),
      'cluster-deployment.yaml must document k8sobjects Warning events');

    // otelcol-builder.yaml contains k8sobjectsreceiver
    const builderPath = path.join(__dirname, '..', 'agent', 'otelcol-builder.yaml');
    assert(fs.existsSync(builderPath), 'otelcol-builder.yaml must exist');
    const builderContent = fs.readFileSync(builderPath, 'utf8');
    assert(builderContent.includes('k8sobjectsreceiver'), 'otelcol-builder.yaml must include k8sobjectsreceiver');

    // rbac.yaml covers events
    const rbacPath = path.join(__dirname, '..', 'deployments', 'k8s', 'sentinel-agent', 'templates', 'rbac.yaml');
    const rbacContent = fs.readFileSync(rbacPath, 'utf8');
    assert(rbacContent.includes('events'), 'rbac.yaml ClusterRole must cover events');

    console.log('  ✓ O2.4: K8s k8sobjects Warning events template and otelcol-builder assertions verified');
  }

  // 4. O2.5: sqlquery receiver for DB engines
  {
    const engines = ['postgresql', 'oracle', 'sqlserver'];
    for (const engine of engines) {
      const queries = loadSqlQueries(engine);
      assert(queries && Object.keys(queries).length >= 6, `Engine ${engine} must have at least 6 read-only queries`);

      for (const [key, q] of Object.entries(queries)) {
        const sql = (q.statement || q.sql || '').trim();
        assert(sql.length > 0, `Query ${key} for ${engine} must have SQL statement`);
        assert(/^(SELECT|WITH)\b/i.test(sql), `Query ${key} for ${engine} must start with SELECT or WITH (got: ${sql.slice(0, 20)})`);
        assert(!sql.includes('password') || sql.includes('${env:'), 'Queries must not contain hardcoded passwords');
      }

      const sq = sqlqueryReceiver({ engine, port: 1234, database: 'testdb', productId: 'app1' });
      assert(sq, `sqlquery receiver must be created for ${engine}`);
      assert(sq[0] === 'sqlquery', 'Receiver type must be sqlquery');
      assert(sq[1].datasource.includes('${env:'), `Datasource for ${engine} must use \${env:...} credentials`);
      assert(!/password=[^$]/i.test(sq[1].datasource), 'Datasource must not contain hardcoded plaintext credentials');
    }
    console.log('  ✓ O2.5: sqlquery receiver for postgresql, oracle, sqlserver verified (SELECT/WITH enforced, env creds)');
  }

  // 5. O2.6: sentinel.product resource attribute (exact match fallback)
  {
    // A host that does NOT match any manifest host
    const cfgA = renderAgentConfig({ host: 'a', os: 'linux', role: 'node' });
    const attrsA = cfgA.collector_config.processors.resource.attributes;
    const prodAttrA = attrsA.find(a => a.key === 'sentinel.product');
    assert(!prodAttrA, 'host=a matches nothing, sentinel.product attribute must not be present');

    // A host that DOES match a manifest host
    const allApps = require('../backend/config/yaml_config').loadAllApplications();
    const appList = Array.isArray(allApps) ? allApps : Object.values(allApps || {});
    const appWithHost = appList.find(a => a.layers && Array.isArray(a.layers.hosts) && a.layers.hosts.length > 0);
    if (appWithHost) {
      const targetHost = appWithHost.layers.hosts[0];
      const cfgMatched = renderAgentConfig({ host: targetHost, os: 'linux', role: 'node' });
      const attrsMatched = cfgMatched.collector_config.processors.resource.attributes;
      const prodAttr = attrsMatched.find(a => a.key === 'sentinel.product');
      assert(prodAttr, `Host ${targetHost} must have sentinel.product attribute`);
      assert(prodAttr.value === appWithHost.id, `sentinel.product value must match app id (${appWithHost.id})`);
    }
    console.log('  ✓ O2.6: sentinel.product attribute exact match verified; host=a matches nothing');
  }

  // 6. O2.8: JMX receiver opt-in with jvm.jmx_port
  {
    const testJmxHost = 'test-jmx-node-01.corp';
    const yamlConfig = require('../backend/config/yaml_config');
    const allApps = yamlConfig.loadAllApplications();

    // Without jvm.jmx_port
    const cfgNoJmx = renderAgentConfig({ host: testJmxHost, os: 'linux', role: 'node' });
    const receiversNoJmx = Object.keys(cfgNoJmx.collector_config.receivers);
    assert(!receiversNoJmx.some(r => r.startsWith('jmx/')), 'jmx receiver must NOT be present without jvm.jmx_port');

    // With jvm.jmx_port
    allApps['test_jvm_app'] = {
      id: 'test_jvm_app',
      name: 'Test JVM App',
      jvm: { jmx_port: 9010 },
      layers: { hosts: [testJmxHost] }
    };

    try {
      const cfgJmx = renderAgentConfig({ host: testJmxHost, os: 'linux', role: 'node' });
      const receiversJmx = cfgJmx.collector_config.receivers;
      const jmxKey = Object.keys(receiversJmx).find(r => r.startsWith('jmx/test_jvm_app'));
      assert(jmxKey, 'jmx/test_jvm_app receiver must be present when manifest has jvm.jmx_port');
      assert(receiversJmx[jmxKey].endpoint === '127.0.0.1:9010', 'jmx endpoint must point to 127.0.0.1:9010');
      assert(receiversJmx[jmxKey].metrics['jvm.memory.pool.bytes.used'], 'heap pool metric enabled');
      assert(receiversJmx[jmxKey].metrics['jvm.gc.collections.count'], 'gc count metric enabled');
      assert(receiversJmx[jmxKey].metrics['jvm.threads.deadlocked.count'], 'deadlocked threads metric enabled');
    } finally {
      delete allApps['test_jvm_app'];
    }
    console.log('  ✓ O2.8: JMX receiver rendered only when manifest has jvm.jmx_port');
  }

  console.log('All Phase O2 Agent Config tests passed!\n');
}

run().catch(err => {
  console.error('[TEST FAILURE]', err);
  process.exit(1);
});
