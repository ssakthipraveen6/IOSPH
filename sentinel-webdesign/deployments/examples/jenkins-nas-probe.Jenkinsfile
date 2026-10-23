// deployments/examples/jenkins-nas-probe.Jenkinsfile
// Scheduled canary pipeline to measure shared enterprise storage latency (NAS/NFS)
// and push telemetry into SENTINEL Custom Metrics API (POST /api/v1/metrics/ingest).

pipeline {
    agent { label 'linux-toolchain-node' }
    triggers {
        cron('H/5 * * * *') // Run every 5 minutes
    }
    environment {
        SENTINEL_ENDPOINT = 'https://sentinel.internal.corp/api/v1/metrics/ingest'
        SENTINEL_API_KEY = credentials('sentinel-nas-probe-ingest-key')
        TARGET_SHARE = '/mnt/enterprise/artifactory-filestore'
    }
    stages {
        stage('Measure Storage Latency') {
            steps {
                sh '''#!/usr/bin/env bash
                    set -euo pipefail
                    
                    if [ ! -d "${TARGET_SHARE}" ]; then
                        echo "[ERROR] Target share ${TARGET_SHARE} is not mounted."
                        exit 1
                    fi

                    # 1. Measure Stat latency
                    START_STAT=$(date +%s%N)
                    stat "${TARGET_SHARE}" > /dev/null
                    END_STAT=$(date +%s%N)
                    STAT_MS=$(awk "BEGIN {print ($END_STAT - $START_STAT)/1000000}")

                    # 2. Measure Write latency
                    CANARY_FILE="${TARGET_SHARE}/.sentinel_canary_${BUILD_NUMBER}.tmp"
                    START_WRITE=$(date +%s%N)
                    echo "SENTINEL_PROBE_${BUILD_NUMBER}" > "${CANARY_FILE}"
                    sync "${CANARY_FILE}"
                    END_WRITE=$(date +%s%N)
                    WRITE_MS=$(awk "BEGIN {print ($END_WRITE - $START_WRITE)/1000000}")

                    # 3. Measure Read latency
                    START_READ=$(date +%s%N)
                    cat "${CANARY_FILE}" > /dev/null
                    END_READ=$(date +%s%N)
                    READ_MS=$(awk "BEGIN {print ($END_READ - $START_READ)/1000000}")

                    # Clean up canary file
                    rm -f "${CANARY_FILE}"

                    # 4. Push metrics to SENTINEL line protocol endpoint
                    HOSTNAME=$(hostname -s)
                    TIMESTAMP_MS=$(date +%s%3N)
                    
                    cat <<EOF > metrics.payload
nas.stat_latency_ms,host=${HOSTNAME},share=${TARGET_SHARE},source=custom value=${STAT_MS} ${TIMESTAMP_MS}
nas.write_latency_ms,host=${HOSTNAME},share=${TARGET_SHARE},source=custom value=${WRITE_MS} ${TIMESTAMP_MS}
nas.read_latency_ms,host=${HOSTNAME},share=${TARGET_SHARE},source=custom value=${READ_MS} ${TIMESTAMP_MS}
EOF

                    curl -k -s -X POST "${SENTINEL_ENDPOINT}" \
                        -H "Content-Type: text/plain" \
                        -H "X-Sentinel-Api-Key: ${SENTINEL_API_KEY}" \
                        --data-binary @metrics.payload

                    echo "[SENTINEL] Ingested NAS metrics: stat=${STAT_MS}ms, write=${WRITE_MS}ms, read=${READ_MS}ms"
                '''
            }
        }
    }
}
