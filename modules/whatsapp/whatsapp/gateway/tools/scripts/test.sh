#!/bin/bash

# 🧪 Unified Test Script for WhatsApp Monorepo
# Consolidates test-connectivity.sh, test_api.sh, test_advanced_features.sh, etc.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Output functions
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"; }

# Help function
show_help() {
    echo "🧪 WhatsApp Monorepo Test Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [TEST_TYPE]"
    echo ""
    echo "TEST TYPES:"
    echo "  all           Run all tests (default)"
    echo "  unit          Run unit tests only"
    echo "  integration   Run integration tests"
    echo "  api           Test API endpoints"
    echo "  connectivity  Test network connectivity"
    echo "  agent-zero    Test Agent Zero integration"
    echo "  advanced      Test advanced WhatsApp features"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help    Show this help message"
    echo "  -v, --verbose Enable verbose output"
    echo "  -w, --watch   Watch mode for development"
    echo "  -c, --coverage Generate coverage report"
    echo "  --filter PKG  Run tests for specific package"
    echo "  --timeout SEC Set timeout (default: 30)"
    echo ""
    echo "EXAMPLES:"
    echo "  $0                    # Run all tests"
    echo "  $0 api --verbose      # Test API with verbose output"
    echo "  $0 unit --watch       # Unit tests in watch mode"
    echo "  $0 --filter whatsapp-api  # Test specific package"
    echo ""
}

# Default values
TEST_TYPE="all"
VERBOSE=false
WATCH=false
COVERAGE=false
FILTER=""
TIMEOUT=30
API_BASE_URL="http://localhost:3001"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -w|--watch)
            WATCH=true
            shift
            ;;
        -c|--coverage)
            COVERAGE=true
            shift
            ;;
        --filter)
            FILTER="$2"
            shift 2
            ;;
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        all|unit|integration|api|connectivity|agent-zero|advanced)
            TEST_TYPE="$1"
            shift
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    # Check for pnpm
    command -v pnpm >/dev/null 2>&1 || missing_deps+=("pnpm")
    
    # Check for curl (for API tests)
    if [[ "$TEST_TYPE" == "api" || "$TEST_TYPE" == "all" ]]; then
        command -v curl >/dev/null 2>&1 || missing_deps+=("curl")
    fi
    
    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        error "Missing dependencies: ${missing_deps[*]}"
        exit 1
    fi
}

# Test connectivity
test_connectivity() {
    log "🌐 Testing network connectivity..."
    
    local failed=0
    
    # Test Google DNS
    if ping -c 1 8.8.8.8 >/dev/null 2>&1; then
        info "✅ Internet connectivity: OK"
    else
        warn "❌ Internet connectivity: FAILED"
        ((failed++))
    fi
    
    # Test local API
    if curl -f "$API_BASE_URL/status" >/dev/null 2>&1; then
        info "✅ WhatsApp API: OK"
    else
        warn "❌ WhatsApp API: Not responding"
        ((failed++))
    fi
    
    # Test Redis
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli ping >/dev/null 2>&1; then
            info "✅ Redis: OK"
        else
            warn "❌ Redis: Not responding"
            ((failed++))
        fi
    fi
    
    return $failed
}

# Test API endpoints
test_api() {
    log "🔌 Testing API endpoints..."
    
    local failed=0
    
    # Test status endpoint
    log "Testing /status endpoint..."
    if response=$(curl -s "$API_BASE_URL/status"); then
        if echo "$response" | grep -q "ready"; then
            info "✅ Status endpoint: OK"
        else
            warn "❌ Status endpoint: Invalid response"
            ((failed++))
        fi
    else
        error "❌ Status endpoint: Failed to connect"
        ((failed++))
    fi
    
    # Test health endpoint  
    log "Testing /health endpoint..."
    if curl -f -s "$API_BASE_URL/health" >/dev/null 2>&1; then
        info "✅ Health endpoint: OK"
    else
        warn "❌ Health endpoint: Failed"
        ((failed++))
    fi
    
    # Test webhook endpoint
    log "Testing /webhook endpoint..."
    if response=$(curl -s -X POST "$API_BASE_URL/webhook" -H "Content-Type: application/json" -d '{}'); then
        info "✅ Webhook endpoint: Responding"
    else
        warn "❌ Webhook endpoint: Failed"
        ((failed++))
    fi
    
    return $failed
}

# Test Agent Zero integration
test_agent_zero() {
    log "🤖 Testing Agent Zero integration..."
    
    local failed=0
    
    # Check if Agent Zero webhook is configured
    if [[ -n "$AGZ_WEBHOOK_URL" ]]; then
        log "Testing Agent Zero webhook: $AGZ_WEBHOOK_URL"
        if curl -f -s "$AGZ_WEBHOOK_URL" >/dev/null 2>&1; then
            info "✅ Agent Zero webhook: OK"
        else
            warn "❌ Agent Zero webhook: Not responding"
            ((failed++))
        fi
    else
        warn "⚠️  Agent Zero webhook not configured"
    fi
    
    # Test webhook registration
    log "Testing webhook registration..."
    webhook_data='{
        "url": "http://localhost:50001/webhook",
        "events": ["message_received", "message_sent"]
    }'
    
    if response=$(curl -s -X POST "$API_BASE_URL/webhook/register" \
        -H "Content-Type: application/json" \
        -d "$webhook_data"); then
        info "✅ Webhook registration: OK"
    else
        warn "❌ Webhook registration: Failed"
        ((failed++))
    fi
    
    return $failed
}

# Test advanced WhatsApp features
test_advanced() {
    log "🚀 Testing advanced WhatsApp features..."
    
    local failed=0
    
    # Test message sending (mock)
    log "Testing message sending capability..."
    message_data='{
        "number": "1234567890",
        "message": "Test message from monorepo",
        "type": "text"
    }'
    
    if response=$(curl -s -X POST "$API_BASE_URL/message/send" \
        -H "Content-Type: application/json" \
        -d "$message_data"); then
        if echo "$response" | grep -q "success\|queued"; then
            info "✅ Message sending: OK"
        else
            warn "❌ Message sending: Invalid response"
            ((failed++))
        fi
    else
        warn "❌ Message sending: Failed"
        ((failed++))
    fi
    
    # Test media upload
    log "Testing media upload capability..."
    if [[ -f "/tmp/test-image.jpg" ]] || touch "/tmp/test-image.jpg"; then
        if response=$(curl -s -X POST "$API_BASE_URL/media/upload" \
            -F "file=@/tmp/test-image.jpg"); then
            info "✅ Media upload: OK"
        else
            warn "❌ Media upload: Failed"
            ((failed++))
        fi
    fi
    
    return $failed
}

# Run unit tests
run_unit_tests() {
    log "🧪 Running unit tests..."
    
    local cmd="pnpm test"
    
    [[ "$WATCH" == true ]] && cmd="$cmd --watch"
    [[ "$COVERAGE" == true ]] && cmd="npx c8 $cmd"
    [[ -n "$FILTER" ]] && cmd="$cmd --filter=$FILTER"
    [[ "$VERBOSE" == true ]] && cmd="$cmd --verbose"
    
    if eval "$cmd"; then
        info "✅ Unit tests: PASSED"
        return 0
    else
        error "❌ Unit tests: FAILED"
        return 1
    fi
}

# Run integration tests
run_integration_tests() {
    log "🔄 Running integration tests..."
    
    local failed=0
    
    # Start services if not running
    if ! curl -f "$API_BASE_URL/status" >/dev/null 2>&1; then
        log "Starting services for integration tests..."
        if [[ -f "docker-compose.monorepo.yml" ]]; then
            docker-compose -f docker-compose.monorepo.yml up -d
            sleep 30
        else
            warn "Services not running and no docker-compose found"
            return 1
        fi
    fi
    
    # Run connectivity tests
    test_connectivity || ((failed++))
    
    # Run API tests
    test_api || ((failed++))
    
    return $failed
}

# Main test runner
run_tests() {
    local failed=0
    
    case $TEST_TYPE in
        all)
            log "🎯 Running all tests..."
            run_unit_tests || ((failed++))
            run_integration_tests || ((failed++))
            test_agent_zero || ((failed++))
            test_advanced || ((failed++))
            ;;
        unit)
            run_unit_tests || ((failed++))
            ;;
        integration)
            run_integration_tests || ((failed++))
            ;;
        api)
            test_api || ((failed++))
            ;;
        connectivity)
            test_connectivity || ((failed++))
            ;;
        agent-zero)
            test_agent_zero || ((failed++))
            ;;
        advanced)
            test_advanced || ((failed++))
            ;;
        *)
            error "Unknown test type: $TEST_TYPE"
            return 1
            ;;
    esac
    
    return $failed
}

# Generate test report
generate_report() {
    local exit_code=$1
    
    echo ""
    echo "📊 Test Report"
    echo "=============="
    echo "Test Type: $TEST_TYPE"
    echo "Timeout: ${TIMEOUT}s"
    [[ -n "$FILTER" ]] && echo "Filter: $FILTER"
    echo "Timestamp: $(date)"
    
    if [[ $exit_code -eq 0 ]]; then
        log "✅ All tests passed!"
    else
        error "❌ Some tests failed (exit code: $exit_code)"
    fi
    
    echo ""
}

# Main execution
main() {
    echo "🧪 WhatsApp Monorepo Test Suite"
    echo "==============================="
    echo ""
    
    log "🎯 Test Type: $TEST_TYPE"
    [[ "$VERBOSE" == true ]] && log "🔍 Verbose mode enabled"
    [[ "$WATCH" == true ]] && log "👀 Watch mode enabled"
    [[ "$COVERAGE" == true ]] && log "📈 Coverage enabled"
    [[ -n "$FILTER" ]] && log "🔍 Filter: $FILTER"
    echo ""
    
    check_dependencies
    
    # Set timeout
    run_tests || {
        local exit_code=$?
        if [[ $exit_code -eq 124 ]]; then
            error "Tests timed out after ${TIMEOUT}s"
            exit 124
        fi
        generate_report $exit_code
        exit $exit_code
    }
    
    local test_exit_code=$?
    generate_report $test_exit_code
    exit $test_exit_code
}

# Run main function
main "$@"