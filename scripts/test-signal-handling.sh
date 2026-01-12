#!/bin/bash
#
# Signal Handling Validation Script
#
# Tests that Ctrl+C (SIGINT) properly kills all child processes spawned by build-prd-set
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🧪 Signal Handling Validation Test"
echo "===================================="
echo ""

# Test file path (use a simple test file if available)
TEST_FILE="${1:-.taskmaster/pre-production/workflow-engine-module.md}"

if [ ! -f "$PROJECT_ROOT/$TEST_FILE" ]; then
    echo "❌ Test file not found: $TEST_FILE"
    echo "Usage: $0 [test-file-path]"
    exit 1
fi

echo "📄 Using test file: $TEST_FILE"
echo ""

# Check if dev-loop is built
if [ ! -f "$PROJECT_ROOT/dist/cli/commands/build-prd-set.js" ]; then
    echo "⚠️  dev-loop not built. Building now..."
    cd "$PROJECT_ROOT"
    npm run build
    echo ""
fi

echo "🔍 Starting build-prd-set process..."
echo "   Command: npx dev-loop build-prd-set --convert $TEST_FILE --auto-approve"
echo ""
echo "📝 Instructions:"
echo "   1. Wait for the process to start background agents (look for 'Starting background agent' in logs)"
echo "   2. Press Ctrl+C ONCE"
echo "   3. Verify that:"
echo "      - Process exits immediately (within 1-2 seconds)"
echo "      - No 'cursor agent' processes remain (check with: ps aux | grep 'cursor agent')"
echo "      - No new files are created after Ctrl+C"
echo ""
echo "🔴 Starting process (press Ctrl+C when ready)..."
echo ""

# Start the process
cd "$PROJECT_ROOT/../.."
npx dev-loop build-prd-set --convert "$TEST_FILE" --auto-approve || EXIT_CODE=$?

echo ""
echo "✅ Process exited with code: ${EXIT_CODE:-0}"
echo ""

# Check for orphaned processes
ORPHANED=$(ps aux | grep -E 'cursor agent|cursor.*--print' | grep -v grep || true)
if [ -n "$ORPHANED" ]; then
    echo "⚠️  WARNING: Orphaned child processes detected:"
    echo "$ORPHANED"
    echo ""
    echo "❌ Validation FAILED: Child processes were not killed"
    exit 1
else
    echo "✅ No orphaned child processes found"
    echo ""
    echo "✅ Validation PASSED: All child processes were killed"
fi
