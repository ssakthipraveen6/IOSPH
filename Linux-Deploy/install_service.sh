#!/usr/bin/env bash
# ====================================================================
# Project Sentinel - Linux Server Background Service Installation
# ====================================================================
# Registers Project Sentinel as a background daemon (systemd service)
# that starts automatically when Linux boots.
# Run this script with sudo/root privileges.
# ====================================================================

# Ensure execution context is root
if [ "$EUID" -ne 0 ]; then
    echo "[WARNING] This script requires root permissions. Please run with sudo."
    exit 1
fi

echo "========================================================"
echo "     Project Sentinel: Background Service Setup"
echo "========================================================"
echo "Configuring Project Sentinel to run natively on startup..."

INSTALL_DIR="/opt/project-sentinel"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Create installation directory if not exists
if [ ! -d "$INSTALL_DIR" ]; then
    echo "[INFO] Creating installation directory: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
fi

# Copy codebase to installation directory
echo "[INFO] Copying files to $INSTALL_DIR..."
cp -R "$SCRIPT_PATH"/* "$INSTALL_DIR/"

# Set executable permissions on start.sh
chmod +x "$INSTALL_DIR/start.sh"

# Install systemd service unit
SERVICE_FILE="project-sentinel.service"
if [ -f "$INSTALL_DIR/$SERVICE_FILE" ]; then
    echo "[INFO] Copying systemd service unit file..."
    cp "$INSTALL_DIR/$SERVICE_FILE" "/etc/systemd/system/$SERVICE_FILE"
    
    # Reload and enable
    echo "[INFO] Reloading systemd daemon..."
    systemctl daemon-reload
    
    echo "[INFO] Enabling Project Sentinel service..."
    systemctl enable project-sentinel
    
    echo "[SUCCESS] Background service registered successfully!"
    echo "To start the daemon, run: systemctl start project-sentinel"
    echo "To check logs, run: journalctl -u project-sentinel -f"
else
    echo "[ERROR] Systemd service configuration ($SERVICE_FILE) not found."
    exit 1
fi
echo "========================================================"
