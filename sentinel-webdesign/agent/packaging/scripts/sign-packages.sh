#!/usr/bin/env bash
# agent/packaging/scripts/sign-packages.sh
# Sign RPM/DEB/MSI binaries using corporate code-signing certificates

set -euo pipefail

SIGNING_CERT="${SIGNING_CERT_PATH:-}"
DIST_DIR="./dist/packages"

if [[ -z "${SIGNING_CERT}" || ! -f "${SIGNING_CERT}" ]]; then
  echo "[SIGN] No valid signing certificate in SIGNING_CERT_PATH. Artifacts will remain flagged as UNSIGNED."
  exit 0
fi

echo "[SIGN] Signing packages in ${DIST_DIR} with ${SIGNING_CERT}..."
# RPM GPG sign
if command -v rpmsign &>/dev/null; then
  for rpm in "${DIST_DIR}"/*.rpm; do
    [[ -f "$rpm" ]] && rpmsign --addsign "$rpm"
  done
fi

# Windows Signtool
if command -v signtool.exe &>/dev/null; then
  for msi in "${DIST_DIR}"/*.msi; do
    [[ -f "$msi" ]] && signtool.exe sign /f "${SIGNING_CERT}" /t http://timestamp.digicert.com "$msi"
  done
fi

echo "[SIGN] Signing step completed."
