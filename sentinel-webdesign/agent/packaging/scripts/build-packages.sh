#!/usr/bin/env bash
# agent/packaging/scripts/build-packages.sh
#
# Stages and builds the SENTINEL agent packages (Phase A6):
#   - Linux RPM + DEB with nfpm (collector, sentinel-probe, osquery, systemd units)
#   - Windows MSI with WiX v4 when `wix` is on PATH
#   - CycloneDX SBOM with syft when available
# Runs without the signing certificate: signing is a separate step
# (sign-packages.sh), and unsigned output is reported as such.
#
# Inputs (binaries are never committed):
#   SENTINEL_OTELCOL_BIN      otelcol build for Linux   (agent/otelcol-builder.yaml)
#   SENTINEL_OTELCOL_EXE      otelcol build for Windows (optional, for the MSI)
#   OSQUERYD_BIN              osqueryd for Linux        (from the internal mirror)
#   OSQUERYD_EXE              osqueryd.exe for Windows  (optional, for the MSI)
#   NODE_EXE                  node.exe for Windows      (optional, for the MSI)
#   SENTINEL_AGENT_VERSION    default 2.4.0
#
# Usage: agent/packaging/scripts/build-packages.sh   (from the repo root)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="${ROOT}/agent/packaging"
BUILD="${PKG}/build"
DIST_DIR="${ROOT}/dist/packages"
export SENTINEL_AGENT_VERSION="${SENTINEL_AGENT_VERSION:-2.4.0}"
VERSION="${SENTINEL_AGENT_VERSION}"

echo "[BUILD] SENTINEL agent v${VERSION}"

# 1. Regenerate the osquery packs from the manifests' watch: paths.
node "${ROOT}/scripts/generate_osquery_pack.js"

# 2. Stage everything under agent/packaging/build/.
rm -rf "${BUILD}"
mkdir -p "${BUILD}"/{bin,probe,config,osquery/packs,systemd,scripts,win} "${DIST_DIR}"
cp "${ROOT}/agent/probe/index.js" "${BUILD}/probe/index.js"
cp "${ROOT}/agent/config/collector-linux.yaml" "${BUILD}/config/collector-linux.yaml"
cp "${ROOT}/agent/config/collector-windows.yaml" "${BUILD}/config/collector-windows.yaml"
cp "${PKG}/probe.json.example" "${BUILD}/config/probe.json"
cp "${ROOT}"/agent/osquery/osquery.conf "${ROOT}"/agent/osquery/osquery.flags "${BUILD}/osquery/"
cp "${ROOT}"/agent/osquery/osquery.windows.conf "${ROOT}"/agent/osquery/osquery.windows.flags "${BUILD}/osquery/"
cp "${ROOT}"/agent/osquery/packs/*.conf "${BUILD}/osquery/packs/"
cp "${PKG}"/systemd/*.service "${BUILD}/systemd/"
cp "${PKG}"/scripts/postinstall.sh "${PKG}"/scripts/preremove.sh "${BUILD}/scripts/"
cp "${PKG}/nfpm.yaml" "${BUILD}/nfpm.yaml"
cp "${PKG}/wix/sentinel-agent.wxs" "${BUILD}/win/sentinel-agent.wxs"

missing=()
stage_bin() { # <env var value> <dest>
  if [[ -n "$1" && -f "$1" ]]; then cp "$1" "$2"; else missing+=("$2"); fi
}
stage_bin "${SENTINEL_OTELCOL_BIN:-}" "${BUILD}/bin/sentinel-agent"
stage_bin "${OSQUERYD_BIN:-}" "${BUILD}/bin/osqueryd"

# 3. SBOM of what is being shipped.
if command -v syft &>/dev/null; then
  syft "dir:${BUILD}" -o cyclonedx-json > "${DIST_DIR}/sentinel-agent-${VERSION}-sbom.json"
  echo "[SBOM] ${DIST_DIR}/sentinel-agent-${VERSION}-sbom.json"
else
  echo "[SBOM] syft not on PATH: no SBOM written."
fi

# 4. Linux packages.
if (( ${#missing[@]} > 0 )); then
  echo "[NFPM] Skipped: missing binaries: ${missing[*]} (set SENTINEL_OTELCOL_BIN and OSQUERYD_BIN)."
elif command -v nfpm &>/dev/null; then
  (cd "${BUILD}" && nfpm package --config nfpm.yaml --packager deb --target "${DIST_DIR}/" \
                 && nfpm package --config nfpm.yaml --packager rpm --target "${DIST_DIR}/")
  echo "[NFPM] DEB and RPM written to ${DIST_DIR} (UNSIGNED until sign-packages.sh runs)."
else
  echo "[NFPM] Skipped: nfpm not on PATH. Staged inputs are in ${BUILD}."
fi

# 5. Windows MSI.
win_ok=true
for v in SENTINEL_OTELCOL_EXE OSQUERYD_EXE NODE_EXE; do
  [[ -n "${!v:-}" && -f "${!v}" ]] || win_ok=false
done
if [[ "${win_ok}" == true ]] && command -v wix &>/dev/null; then
  cp "${SENTINEL_OTELCOL_EXE}" "${BUILD}/win/sentinel-agent.exe"
  cp "${OSQUERYD_EXE}" "${BUILD}/win/osqueryd.exe"
  cp "${NODE_EXE}" "${BUILD}/win/node.exe"
  (cd "${BUILD}/win" && wix build -d Version="${VERSION}" -d BuildDir="${BUILD}" sentinel-agent.wxs -o "${DIST_DIR}/sentinel-agent-${VERSION}-x64.msi")
  echo "[WIX] MSI written (UNSIGNED until sign-packages.sh runs)."
else
  echo "[WIX] Skipped: needs wix on PATH and SENTINEL_OTELCOL_EXE, OSQUERYD_EXE, NODE_EXE."
fi

echo "[DONE] Build step finished. Sign with agent/packaging/scripts/sign-packages.sh."
