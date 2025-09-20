# Contributing to Agent Zero

This guide provides information for developers working on the Agent Zero monorepo.

## Prerequisites

- **Node.js** (>=18.0.0) with npm (>=8.0.0)
- **Python** (>=3.10)
- **Git** (>=2.20)
- **Make** (for using convenience commands)

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jubenitogarcia/agent-zero.git
   cd agent-zero
   ```

2. **Install dependencies:**
   ```bash
   make install
   # OR manually:
   npm install
   pip install -e ".[dev]"
   ```

3. **Set up development environment:**
   ```bash
   make setup
   ```

4. **Start development servers:**
   ```bash
   make dev
   # OR start specific services:
   make dev-agent     # Agent Zero core only
   make dev-webui     # WebUI only
   make dev-crm       # CRM only
   ```

## Repository Structure

```
agent-zero/
├── apps/                           # Applications
│   ├── agent-zero-core/           # Core Agent Zero application
│   ├── webui/                     # Web UI components
│   ├── crm/                       # CRM system
│   ├── whatsapp-gateway/          # WhatsApp integration
│   └── broadhub/                  # BroadHub functionality
├── packages/                       # Shared packages
│   ├── shared-configs/            # Shared configurations (ESLint, Prettier, etc.)
│   ├── shared-types/              # Shared TypeScript types
│   └── shared-utils/              # Shared utilities
├── tools/                         # Development tools and scripts
│   └── scripts/                   # Unified scripts
│       └── restart.sh             # Unified restart script
├── docs/                          # Documentation
├── tests/                         # Test files
└── [configuration files]          # Root-level configs
```

## Development Workflow

### Code Quality

We use automated code quality tools:

- **ESLint** for JavaScript/TypeScript linting
- **Prettier** for code formatting
- **Black** and **isort** for Python formatting
- **flake8** for Python linting
- **mypy** for Python type checking

Run quality checks:
```bash
make lint          # Run all linting
make format        # Format all code
make typecheck     # Run type checking
make check         # Run all checks (lint + typecheck + test)
```

### Testing

```bash
make test          # Run all tests
make test-python   # Run Python tests only
make test-js       # Run JavaScript/TypeScript tests only
make test-coverage # Run tests with coverage
```

### Building

```bash
make build         # Build all packages
make build-python  # Build Python packages only
make build-js      # Build JavaScript packages only
```

## Working with Services

### Agent Zero Core

The main AI agent framework written in Python.

**Development:**
```bash
make dev-agent
# OR
./tools/scripts/restart.sh --service agent-zero --watch
```

**Configuration:**
- Main config: `config.py`
- Environment: `.env` (copy from `.env.example`)

### WebUI

React-based web interface for Agent Zero.

**Development:**
```bash
make dev-webui
# OR
nx run webui:dev
```

### CRM System

Customer relationship management functionality.

**Development:**
```bash
make dev-crm
```

### WhatsApp Gateway

Integration with WhatsApp messaging.

**Development:**
```bash
make dev-gateway
```

## Scripts and Commands

### Available Make Commands

| Command | Description |
|---------|-------------|
| `make help` | Show all available commands |
| `make install` | Install all dependencies |
| `make setup` | Complete setup for new developers |
| `make dev` | Start all development servers |
| `make test` | Run all tests |
| `make lint` | Run linting on all code |
| `make format` | Format all code |
| `make build` | Build all packages |
| `make clean` | Clean build artifacts |

### Unified Restart Script

The new unified restart script replaces multiple scattered scripts:

```bash
# Start all services
./tools/scripts/restart.sh

# Start specific service
./tools/scripts/restart.sh --service agent-zero
./tools/scripts/restart.sh --service crm

# Development mode with hot reload
./tools/scripts/restart.sh --service agent-zero --watch

# Kill all processes
./tools/scripts/restart.sh --kill-only

# Show help
./tools/scripts/restart.sh --help
```

## Package Management

### Python Dependencies

Main dependencies are defined in `pyproject.toml`. For development:

```bash
# Install in development mode
pip install -e ".[dev]"

# Add new dependency
echo "new-package>=1.0.0" >> pyproject.toml
pip install -e ".[dev]"
```

### Node.js Dependencies

We use npm workspaces for JavaScript/TypeScript packages:

```bash
# Install for root workspace
npm install package-name

# Install for specific app/package
npm install package-name --workspace=apps/webui

# Add dev dependency
npm install --save-dev package-name
```

## Environment Configuration

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Configure required variables:**
   ```bash
   # Agent Zero Configuration
   AGENT_ZERO_PORT=50001
   
   # Redis Configuration
   REDIS_URL=redis://localhost:6379/1
   
   # WhatsApp Configuration
   WHATSAPP_WEBHOOK_SECRET=your-secret-here
   
   # Authentication
   AUTH_LOGIN=admin
   AUTH_PASSWORD=admin
   ```

## Adding New Features

### Creating a New App

```bash
# Generate new app using Nx
nx generate @nx/node:application my-new-app

# OR manually create structure
mkdir apps/my-new-app
cd apps/my-new-app
npm init -y
```

### Creating a New Package

```bash
# Generate new package using Nx
nx generate @nx/js:library my-new-package

# OR manually create structure
mkdir packages/my-new-package
cd packages/my-new-package
npm init -y
```

## Git Workflow

1. **Create feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and commit:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Run checks before pushing:**
   ```bash
   make check
   ```

4. **Push and create PR:**
   ```bash
   git push origin feature/my-feature
   ```

## CI/CD

Our CI/CD pipeline runs automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

**Pipeline includes:**
- Code quality checks (ESLint, Prettier, Black, flake8)
- Type checking (TypeScript, mypy)
- Tests (Jest, pytest)
- Security scanning
- Build verification
- Documentation generation

## Troubleshooting

### Common Issues

1. **Port conflicts:**
   ```bash
   # Kill all processes
   ./tools/scripts/restart.sh --kill-only
   
   # Check what's using ports
   lsof -i :50001
   ```

2. **Dependency conflicts:**
   ```bash
   # Clean and reinstall
   make clean-all
   make install
   ```

3. **Build failures:**
   ```bash
   # Clean build cache
   make clean
   nx reset
   ```

### Getting Help

- Check the [documentation](docs/)
- Review [existing issues](https://github.com/jubenitogarcia/agent-zero/issues)
- Ask in [discussions](https://github.com/jubenitogarcia/agent-zero/discussions)

## Code Style Guidelines

### Python

- Use **Black** for formatting (line length: 88)
- Use **isort** for import sorting
- Follow **PEP 8** guidelines
- Add type hints for all functions
- Write docstrings for all public functions

### JavaScript/TypeScript

- Use **Prettier** for formatting
- Use **ESLint** recommended rules
- Prefer TypeScript over JavaScript
- Use meaningful variable names
- Add JSDoc comments for complex functions

### Commit Messages

Follow conventional commits format:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `style:` for formatting changes
- `refactor:` for code refactoring
- `test:` for tests
- `chore:` for maintenance

## Performance Guidelines

### Development

- Use hot reload for faster development (`--watch` flag)
- Run only necessary services during development
- Use `make dev-agent` instead of `make dev` if only working on core

### Production

- Build with optimization: `make build`
- Use environment-specific configurations
- Monitor resource usage with provided metrics

## Security Guidelines

- Never commit secrets or API keys
- Use environment variables for configuration
- Run security checks: `make security-check`
- Keep dependencies updated: `make upgrade`
- Follow security best practices in code