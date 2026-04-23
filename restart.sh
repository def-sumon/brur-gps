#!/bin/bash
set -e

echo "🔄 Restarting GPS API"
echo "================================="

PORT=3000
APP_NAME="GPS API"
BRANCH="main"

# Ensure project root
if [ ! -f package.json ]; then
    echo "❌ package.json not found. Run from project root."
    exit 1
fi

# -------------------------------
# 📥 Get latest code
# -------------------------------
echo ""
echo "📥 Pulling latest code from Git ($BRANCH)..."

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "⚠️  Local changes found, stashing..."
    git stash push -m "auto-stash-$(date +%s)"
fi

git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

echo "✅ Code updated"

# -------------------------------
# 🛑 Stop existing server
# -------------------------------
echo ""
echo "📍 Checking port $PORT..."
PID=$(lsof -ti:$PORT || true)

if [ -n "$PID" ]; then
    echo "🛑 Stopping existing server (PID: $PID)..."
    kill $PID
    sleep 2

    if lsof -ti:$PORT >/dev/null; then
        echo "⚠️  Force killing..."
        kill -9 $PID
    fi

    echo "✅ Old server stopped"
else
    echo "ℹ️  No server running"
fi

# -------------------------------
# 📦 Install runtime dependencies
# -------------------------------
echo ""
echo "📦 Installing dependencies..."
npm install --omit=dev --prefer-offline

echo "✅ Dependencies installed"

# -------------------------------
# 🚀 Start server with nohup
# -------------------------------
echo ""
echo "🚀 Starting $APP_NAME with nohup"
echo "🌍 NODE_ENV=production"
echo ""

nohup npm run start > /dev/null 2>&1 &

SERVER_PID=$!
echo "✅ Server started (PID: $SERVER_PID)"

# -------------------------------
# ⏳ Wait & health check
# -------------------------------
sleep 4

echo ""
echo "🧪 Health check..."
if curl -sf http://localhost:$PORT/api/v1/health -o /dev/null; then
    echo "✅ Server is healthy"
else
    echo "❌ Health check failed"
    exit 1
fi

echo ""
echo "🎉 Deployment successful"
echo "📝 PID: $SERVER_PID"
echo "🛑 Stop server: kill $SERVER_PID"
echo ""
