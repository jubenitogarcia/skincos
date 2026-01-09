#!/bin/bash

# ============================================================================
# TEST MIGRATION SCRIPT - Organize scattered test files
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔄 Test Migration Script${NC}"
echo "Organizing scattered test files into proper structure..."

# Create legacy tests directory (canonical: archive/tools/legacy-tests) + compat symlink
mkdir -p archive/tools/legacy-tests
ln -sfn ../../archive/tools/legacy-tests tools/scripts/legacy-tests

# Count current test files
TEST_COUNT=$(find . -maxdepth 1 -name "test_*.py" | wc -l)
echo -e "${YELLOW}📊 Found ${TEST_COUNT} test files in root directory${NC}"

# List all test files for analysis
echo -e "${BLUE}📋 Test files found:${NC}"
find . -maxdepth 1 -name "test_*.py" | sort

echo ""
echo -e "${BLUE}🔍 Analyzing test file types...${NC}"

# Categorize tests based on naming patterns
UNIT_TESTS=()
INTEGRATION_TESTS=()
DEBUG_TESTS=()

while IFS= read -r -d '' file; do
    basename=$(basename "$file")
    echo "  • $basename"
    
    if [[ "$basename" =~ (auth|phone|format|generation) ]]; then
        UNIT_TESTS+=("$file")
        echo -e "    ${GREEN}→ Unit test${NC}"
    elif [[ "$basename" =~ (complete|integration|real|agent_zero) ]]; then
        INTEGRATION_TESTS+=("$file")
        echo -e "    ${BLUE}→ Integration test${NC}"
    elif [[ "$basename" =~ (debug|fixes|gateway|media|bulk) ]]; then
        DEBUG_TESTS+=("$file")
        echo -e "    ${YELLOW}→ Debug/utility test${NC}"
    else
        DEBUG_TESTS+=("$file")
        echo -e "    ${YELLOW}→ Uncategorized (moving to debug)${NC}"
    fi
done < <(find . -maxdepth 1 -name "test_*.py" -print0)

echo ""
echo -e "${BLUE}📈 Migration summary:${NC}"
echo -e "  Unit tests: ${#UNIT_TESTS[@]}"
echo -e "  Integration tests: ${#INTEGRATION_TESTS[@]}"
echo -e "  Debug/utility tests: ${#DEBUG_TESTS[@]}"

# Simulate migration (don't actually move files yet)
echo ""
echo -e "${YELLOW}🚧 Migration plan (simulation mode):${NC}"

echo -e "${GREEN}Unit tests → tests/unit/${NC}"
for test in "${UNIT_TESTS[@]}"; do
    echo "  $test → tests/unit/$(basename "$test")"
done

echo -e "${BLUE}Integration tests → tests/integration/${NC}"
for test in "${INTEGRATION_TESTS[@]}"; do
    echo "  $test → tests/integration/$(basename "$test")"
done

echo -e "${YELLOW}Debug tests → tools/scripts/legacy-tests/${NC}"
for test in "${DEBUG_TESTS[@]}"; do
    echo "  $test → tools/scripts/legacy-tests/$(basename "$test")"
done

echo ""
echo -e "${BLUE}💡 To execute migration, run:${NC}"
echo "  ./backend/tools/scripts/migrate-tests.sh --execute"

echo ""
echo -e "${GREEN}✅ Migration analysis complete${NC}"

# If --execute flag is provided, perform actual migration
if [[ "$1" == "--execute" ]]; then
    echo ""
    echo -e "${RED}⚠️  EXECUTING MIGRATION...${NC}"
    
    # Move unit tests
    for test in "${UNIT_TESTS[@]}"; do
        mv "$test" "tests/unit/"
        echo -e "${GREEN}✓${NC} Moved $(basename "$test") to tests/unit/"
    done
    
    # Move integration tests
    for test in "${INTEGRATION_TESTS[@]}"; do
        mv "$test" "tests/integration/"
        echo -e "${GREEN}✓${NC} Moved $(basename "$test") to tests/integration/"
    done
    
    # Move debug tests
    for test in "${DEBUG_TESTS[@]}"; do
        mv "$test" "tools/scripts/legacy-tests/"
        echo -e "${GREEN}✓${NC} Moved $(basename "$test") to tools/scripts/legacy-tests/"
    done
    
    echo ""
    echo -e "${GREEN}🎉 Migration completed successfully!${NC}"
    echo -e "${BLUE}📊 New structure:${NC}"
    echo "  tests/unit/: $(ls tests/unit/test_*.py 2>/dev/null | wc -l) files"
    echo "  tests/integration/: $(ls tests/integration/test_*.py 2>/dev/null | wc -l) files"
    echo "  tools/scripts/legacy-tests/: $(ls tools/scripts/legacy-tests/test_*.py 2>/dev/null | wc -l) files"
fi
