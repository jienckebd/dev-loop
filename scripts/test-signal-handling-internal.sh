#!/bin/bash
#
# Internal Signal Handling Test
# Tests that Ctrl+C properly kills all child processes
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"

# Test file
TEST_FILE=".taskmaster/pre-production/workflow-engine-module.md"

echo "🧪 Testing signal handling..."
echo ""

# Start the process in the background
cd "$WORKSPACE_ROOT"
echo "Starting build-prd-set process..."
npx dev-loop build-prd-set --convert "$TEST_FILE" --output-dir=.taskmaster/planning/builds/test-signal-tmp --auto-approve > /tmp/dev-loop-test.log 2>&1 &
PID=$!

echo "Process started with PID: $PID"
echo "Waiting 5 seconds for background agents to start..."
sleep 5

# Check if process is still running
if ! kill -0 $PID 2>/dev/null; then
    echo "❌ Process already exited before signal"
    cat /tmp/dev-loop-test.log
    exit 1
fi

# Check for child processes (cursor agent processes)
CHILD_PROCESSES=$(ps aux | grep -E "cursor agent|cursor.*--print" | grep -v grep || true)
if [ -n "$CHILD_PROCESSES" ]; then
    echo "✅ Found child processes (this is expected):"
    echo "$CHILD_PROCESSES" | head -3
else
    echo "⚠️  No child processes found yet (may not have started)"
fi

echo ""
echo "Sending SIGINT to process $PID..."
kill -INT $PID

# Wait for process to exit (max 5 seconds)
TIMEOUT=5
ELAPSED=0
while kill -0 $PID 2>/dev/null && [ $ELAPSED -lt $TIMEOUT ]; do
    sleep 0.1
    ELAPSED=$((ELAPSED + 1))
done

# Check if process exited
if kill -0 $PID 2>/dev/null; then
    echo "❌ Process did not exit within ${TIMEOUT} seconds"
    kill -KILL $PID 2>/dev/null || true
    exit 1
fi

echo "✅ Process exited within ${ELAPSED}0ms"

# Check for orphaned child processes
sleep 1  # Give processes time to clean up
ORPHANED=$(ps aux | grep -E "cursor agent|cursor.*--print" | grep -v grep || true)
if [ -n "$ORPHANED" ]; then
    echo "❌ FAILED: Orphaned child processes detected:"
    echo "$ORPHANED"
    exit 1
else
    echo "✅ PASSED: No orphaned child processes"
fi

echo ""
echo "✅ Signal handling test PASSED"
cat /tmp/dev-loop-test.log | tail -20 || true
