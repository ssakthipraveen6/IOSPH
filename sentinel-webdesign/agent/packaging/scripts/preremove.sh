#!/bin/sh
# sentinel-agent preremove: stop and disable the units.
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop sentinel-probe.service sentinel-agent.service sentinel-osquery.service || true
  systemctl disable sentinel-probe.service sentinel-agent.service sentinel-osquery.service || true
fi
exit 0
