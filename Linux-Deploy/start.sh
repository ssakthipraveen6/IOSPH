#!/usr/bin/env bash
# =======================================================
#     Project Sentinel: Autonomous Observability Portal
#              Native Linux Server Hosting
# =======================================================

echo "======================================================="
echo "    Project Sentinel: Autonomous Observability Portal"
echo "              Native Linux Server Hosting"
echo "======================================================="
echo ""

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in system PATH."
    echo "Please install Node.js (version 20 or higher) and try again."
    exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
    echo "[INFO] First run detected. Installing backend dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install backend dependencies."
        exit 1
    fi
fi

if [ -f "frontend/dist/index.html" ]; then
    echo "[INFO] Pre-compiled frontend assets found. Skipping installation and compile steps."
else
    if [ ! -d "frontend/node_modules" ]; then
        echo "[INFO] Installing frontend dependencies..."
        cd frontend
        npm install
        cd ..
        if [ $? -ne 0 ]; then
            echo "[ERROR] Failed to install frontend dependencies."
            exit 1
        fi
    fi

    # Compile the React Production build
    echo ""
    echo "[INFO] Compiling production frontend bundle..."
    npm run build-frontend
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to compile React frontend bundle."
        exit 1
    fi
fi

# Start the application
echo ""
echo "[INFO] Starting observability daemon server..."
echo "[INFO] Project Sentinel will be available at http://localhost:3001"
echo ""
npm run start
if [ $? -ne 0 ]; then
    echo "[ERROR] Observability daemon stopped unexpectedly."
    exit 1
fi
