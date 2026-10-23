#!/bin/sh
# sentinel-agent postinstall: service user, log dir for osquery, enable units.
set -e
if ! id sentinel >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /sbin/nologin sentinel || true
fi
mkdir -p /var/log/osquery /var/lib/sentinel
chown sentinel:sentinel /var/lib/sentinel
chmod 0755 /var/log/osquery
chown root:sentinel /etc/sentinel/collector.yaml /etc/sentinel/probe.json 2>/dev/null || true
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
  systemctl enable sentinel-osquery.service sentinel-agent.service sentinel-probe.service || true
fi
exit 0
