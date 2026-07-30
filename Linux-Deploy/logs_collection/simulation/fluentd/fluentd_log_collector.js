const normalLogs = [
  "[BB-NET] GIT received push request for repository: sentinel-api - User: admin",
  "[DB-POOL] Acquired active transaction thread for client: bitbucket (elapsed: 2ms)",
  "[ART-REPO] Artifact uploaded successfully: /maven-stg/io/sentinel/portal/1.1.0/portal-1.1.0.jar",
  "[ARGO-SYNC] Comparing application state git rev: b492ac9d with cluster K8s resources... Sync OK",
  "[TC-BUILD] Build step completed successfully: Compile artifacts for project 'Remediator' (agent: node-2)",
  "[JENKINS-EVC] Executor #3 polling Jenkins Git Hook trigger queue... Empty",
  "[IIS-SERVER] GET /api/health - Client IP: 10.194.22.45 - Status 200 OK (elapsed: 15ms)",
  "[NEX-VIOL] Scanned jar 'spring-core-5.3.9.jar'. Found 0 critical policy violations",
  "[S3-BUCK] Performing multipart backup archiving snapshot sentinel_db_dump.sql (bandwidth: 84.5 MB/s)"
];

const errorLogs = {
  jenkins_k8s: [
    "[JENKINS-FATAL] FATAL: java.io.IOException: No space left on device. Node execution aborted.",
    "[JENKINS-CRASH] K8s container runner terminated with exit code 137 (OOMKilled)."
  ],
  nas_performance: [
    "[NAS-VOL-ERROR] High latency write operations detected. Average latency: 450ms. Volume full threshold warning.",
    "[NAS-FS-ALERT] Filesystem utilization reached 98.4%. Disk exhausted warning."
  ],
  artifactory: [
    "[ART-MEM-LEAK] java.lang.OutOfMemoryError: Java heap space. Dumping heap to java_pid28412.hprof...",
    "[ART-FATAL] JVM Garbage Collection overhead limit exceeded."
  ],
  database: [
    "[DB-ERR] Fatal error: Database connection pool saturated. Connections count: 100. Connection refused.",
    "[DB-FAILOVER] Primary PostgreSQL node database offline. Failed ping check."
  ],
  avi_load_balancer: [
    "[AVI-INGRESS-SATURATED] Ingress network bottleneck detected. Request queue length: 500.",
    "[AVI-TIMEOUT] Gateway Timeout 504. Connection dropped for application routing."
  ]
};

function collectFluentdLogs(simulations, db, writeNasLog) {
  const linesGenerated = [];
  
  for (let i = 0; i < 2; i++) {
    const idx = Math.floor(Math.random() * normalLogs.length);
    linesGenerated.push(normalLogs[idx]);
  }
  
  Object.keys(simulations).forEach(comp => {
    const sim = simulations[comp];
    if (sim && errorLogs[comp]) {
      const errPool = errorLogs[comp];
      const idx = Math.floor(Math.random() * errPool.length);
      linesGenerated.push(errPool[idx]);
    }
  });
  
  linesGenerated.forEach(line => {
    writeNasLog('INFO', 'LOG_AGENT', line);
  });
  
  return linesGenerated;
}

module.exports = {
  collectFluentdLogs
};
