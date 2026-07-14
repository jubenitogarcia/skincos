# Test Infrastructure and Coverage Guide

This document describes the test infrastructure and coverage setup for the WhatsApp monorepo.

## Overview

The repository uses a comprehensive test infrastructure with:
- **c8** for code coverage collection
- **Mocha** + **Chai** + **Sinon** for testing framework
- **Turbo** for monorepo test orchestration
- **GitHub Actions** for CI/CD with coverage publishing

## Quick Start

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run specific test types
pnpm test:unit
pnpm test:api
pnpm test:connectivity

# Run with coverage using unified script
./tools/scripts/test.sh unit --coverage
```

### Coverage Reports

```bash
# Generate coverage reports
pnpm coverage

# Clean coverage data
pnpm coverage:clean
```

Coverage reports are generated in multiple formats:
- **HTML**: `coverage/index.html` - Interactive web report
- **LCOV**: `coverage/lcov.info` - For CI/CD integration
- **Text**: Console output with summary

## Project Structure

### Test Locations
```
├── tests/                          # Root-level integration tests
├── apps/whatsapp-api/tests/        # WhatsApp API specific tests
├── packages/shared-utils/src/       # Shared utilities tests (*.test.js)
└── tools/scripts/test.sh           # Unified test runner script
```

### Mock Utilities
```
apps/whatsapp-api/tests/mocks/
├── index.js                        # Standardized mock utilities
└── README.md                       # Mock usage documentation
```

## Coverage Configuration

### Root Level (package.json)
```json
{
  "scripts": {
    "test:coverage": "c8 pnpm test",
    "coverage": "c8 report --reporter=text --reporter=lcov --reporter=html"
  },
  "c8": {
    "reporter": ["text", "lcov", "html"],
    "reports-dir": "coverage",
    "all": true,
    "include": [
      "src/**/*.js",
      "apps/*/src/**/*.js", 
      "packages/*/src/**/*.js"
    ],
    "exclude": [
      "**/*.test.js",
      "**/*.spec.js",
      "**/tests/**",
      "**/coverage/**"
    ]
  }
}
```

### Package Level
Each package has its own coverage configuration optimized for its structure.

## Mock Utilities

### Available Mocks

```javascript
const { 
  createMockClient,
  createMockMessage, 
  createMockChat,
  createMockContact,
  createMockApiResponse,
  createMockWebhookPayload,
  sleep
} = require('./tests/mocks');

// Create mock WhatsApp client
const client = createMockClient({
  ready: true,
  authenticated: true
});

// Create mock message
const message = createMockMessage({
  body: 'Test message',
  from: '1234567890@c.us'
});
```

### Mock Features
- **Realistic data structures** matching WhatsApp Web.js
- **Configurable properties** for different test scenarios
- **Method stubs** with Promise-based responses
- **Extensible design** for custom test needs

## CI/CD Integration

### GitHub Actions Workflow

The test infrastructure integrates with GitHub Actions:

```yaml
- name: Run tests
  run: pnpm test --filter=${{ matrix.package }}
  
- name: Generate coverage report  
  run: pnpm test:coverage --filter=${{ matrix.package }}
  if: matrix.package == 'whatsapp-api'
  
- name: Upload coverage
  uses: codecov/codecov-action@v3
  if: matrix.package == 'whatsapp-api'
  with:
    file: ./apps/whatsapp-api/coverage/lcov.info
    fail_ci_if_error: true
```

### Coverage Publishing

Coverage reports are automatically:
1. **Generated** during CI runs
2. **Uploaded** to Codecov
3. **Displayed** in pull request comments
4. **Tracked** for coverage trends

## Test Types

### Unit Tests
- **Location**: `src/**/*.test.js`
- **Purpose**: Test individual functions and classes
- **Command**: `pnpm test:unit`

### Integration Tests  
- **Location**: `tests/`
- **Purpose**: Test component interactions
- **Command**: `pnpm test:integration`

### API Tests
- **Location**: `tools/scripts/test.sh api`
- **Purpose**: Test REST API endpoints
- **Command**: `pnpm test:api`

### Connectivity Tests
- **Purpose**: Test network and service dependencies
- **Command**: `pnpm test:connectivity`

## Best Practices

### Writing Tests
1. **Use descriptive test names** that explain the behavior
2. **Follow AAA pattern** (Arrange, Act, Assert)
3. **Mock external dependencies** using provided utilities
4. **Test both success and error cases**
5. **Keep tests isolated** and independent

### Coverage Goals
- **Statements**: Target 80%+ coverage
- **Branches**: Test all code paths
- **Functions**: Ensure all public methods tested
- **Lines**: Comprehensive line coverage

### Mock Usage
1. **Use provided mocks** for WhatsApp objects
2. **Configure realistic data** for test scenarios
3. **Test edge cases** with mock variations
4. **Avoid over-mocking** - test real logic when possible

## Troubleshooting

### Common Issues

**Tests not found**
```bash
# Ensure test files follow naming convention
# *.test.js or *.spec.js in appropriate directories
```

**Coverage not collecting**
```bash
# Check c8 configuration in package.json
# Verify include/exclude patterns
# Run with --verbose for debugging
```

**Mock objects missing methods**
```bash
# Extend mock utilities in tests/mocks/index.js
# Add missing methods to mock objects
# Check test expectations match mock interface
```

### Debug Commands
```bash
# Verbose test output
./tools/scripts/test.sh unit --verbose

# Coverage with detailed output  
npx c8 --reporter=text-summary pnpm test

# Check test file patterns
find . -name "*.test.js" -o -name "*.spec.js"
```

## Contributing

When adding new tests:
1. **Follow existing patterns** in test organization
2. **Use mock utilities** for consistent test objects
3. **Add coverage verification** for new code
4. **Update documentation** for new test types
5. **Test in CI environment** before merging

---

For questions or issues with the test infrastructure, please refer to the main repository documentation or open an issue.