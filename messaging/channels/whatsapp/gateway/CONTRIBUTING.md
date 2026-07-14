# Contributing to WhatsApp Monorepo

Thank you for your interest in contributing! This guide will help you get started.

## 📋 Code of Conduct

This project adheres to the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## 🏗️ Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0 (or npm >= 9.0.0)
- Docker >= 20.0.0
- Git

### Quick Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/WhatsApp.git
   cd WhatsApp
   ```

2. **Automated Setup**
   ```bash
   # Complete setup (recommended)
   npm run setup:all
   
   # Or individual components
   npm run setup:node      # Node.js and dependencies
   npm run setup:docker    # Docker environment
   npm run setup:chromium  # Chromium for Puppeteer
   ```

3. **Environment Configuration**
   ```bash
   # Copy and configure environment files
   cp .env.dev .env
   cp apps/whatsapp-api/.env.example apps/whatsapp-api/.env
   
   # Edit configuration as needed
   nano .env
   ```

4. **Verify Setup**
   ```bash
   # Run all verification checks
   npm run lint
   npm run test
   npm run build
   
   # Start development environment
   npm run deploy:dev
   ```

## 🎯 Development Workflow

### Branch Strategy

- `main`: Production-ready code
- `develop`: Integration branch for features
- `feature/*`: Feature branches
- `fix/*`: Bug fix branches
- `docs/*`: Documentation updates

### Making Changes

1. **Create Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow the existing code style
   - Write tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   # Run all checks
   npm run lint
   npm run test:all
   npm run build
   
   # Test specific components
   npm run test:unit           # Unit tests
   npm run test:api            # API tests
   npm run test:connectivity   # Network tests
   
   # Start development environment
   npm run deploy:dev
   ```

4. **Commit Changes**
   ```bash
   # Follow conventional commits
   git commit -m "feat: add new WhatsApp feature"
   ```

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**
- `feat`: New features
- `fix`: Bug fixes
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks

**Examples:**
```
feat(api): add message scheduling functionality
fix(utils): resolve phone number formatting issue
docs: update API documentation
```

## 📁 Project Structure

```
WhatsApp/
├── apps/                    # Applications
│   └── whatsapp-api/       # Main API service
│       ├── src/            # Source code
│       ├── tests/          # Test files
│       ├── Dockerfile      # Docker configuration
│       └── package.json    # Package config
├── packages/               # Shared packages
│   ├── shared-utils/       # Common utilities
│   └── shared-types/       # Type definitions
├── tools/                  # Build tools
│   └── configs/           # Shared configurations
└── docs/                   # Documentation
```

## 🧪 Testing

### Running Tests

```bash
# All tests
npm run test:all

# Specific test types
npm run test:unit           # Unit tests
npm run test:api            # API integration tests
npm run test:connectivity   # Network connectivity tests
npm run test:advanced       # Advanced features tests

# Watch mode
npm run test:unit -- --watch

# Coverage
npm run test:unit -- --coverage

# Security tests
npm run test:security
```

### Writing Tests

- Place test files in `tests/` directory
- Use descriptive test names
- Follow existing test patterns
- Aim for good coverage of new code

Example test structure:
```javascript
const { expect } = require('chai');
const { formatPhoneNumber } = require('../src/utils');

describe('formatPhoneNumber', () => {
  it('should format phone number correctly', () => {
    const result = formatPhoneNumber('1234567890');
    expect(result).to.equal('1234567890@c.us');
  });
});
```

## 🎨 Code Style

### ESLint & Prettier

We use ESLint and Prettier for code formatting:

```bash
# Check linting
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Type checking (if applicable)
npm run typecheck
```

### Style Guidelines

- Use meaningful variable names
- Add JSDoc comments for functions
- Keep functions small and focused
- Use consistent indentation (2 spaces)
- Add trailing commas in objects/arrays

## 📦 Adding New Packages

1. **Create Package Directory**
   ```bash
   mkdir packages/new-package
   ```

2. **Create package.json**
   ```json
   {
     "name": "@whatsapp-monorepo/new-package",
     "version": "1.0.0",
     "scripts": {
       "build": "...",
       "test": "...",
       "lint": "..."
     }
   }
   ```

3. **Update Workspace**
   ```bash
   npm install
   # or if using pnpm: pnpm install
   ```

## 🚀 Publishing

We use [Changesets](https://github.com/changesets/changesets) for versioning:

1. **Add Changeset**
   ```bash
   npm run changeset
   # or: npx changeset
   ```

2. **Follow the prompts** to describe your changes

3. **Commit the changeset** along with your changes

## 🚀 Deployment

For deployment and testing, use the unified scripts:

```bash
# Development deployment
npm run deploy:dev

# Production deployment  
npm run deploy:prod

# Testing deployment
npm run deploy:test

# Infrastructure deployment
npm run deploy:infrastructure

# Manual deployment with options
./tools/scripts/deploy.sh local --env dev --profile tools
```

## 🐛 Reporting Issues

When reporting issues, please include:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Error logs or screenshots

## 💡 Feature Requests

For feature requests, please:

- Check existing issues first
- Provide clear use case
- Explain the benefits
- Consider implementation complexity

### Resources
- **[README](README.md)** - Project overview and quick start
- **[Development Guide](DEVELOPMENT.md)** - Detailed development setup
- **[Security Policy](SECURITY.md)** - Security guidelines
- **[Turborepo Documentation](https://turbo.build/)**
- **[pnpm Workspaces](https://pnpm.io/workspaces)**
- **[Conventional Commits](https://www.conventionalcommits.org/)**
- **[Changesets](https://github.com/changesets/changesets)**

## ❓ Questions?

- Open a [Discussion](https://github.com/jubenitogarcia/WhatsApp/discussions)
- Check existing [Issues](https://github.com/jubenitogarcia/WhatsApp/issues)
- Read the [Documentation](./docs/)

Thank you for contributing! 🎉