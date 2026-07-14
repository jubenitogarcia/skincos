# WhatsApp Enterprise Monorepo

A unified monorepo architecture for WhatsApp automation and integrations, built with modern tooling and best practices.

## 🏗️ Architecture

```
WhatsApp/
├── apps/                    # Applications
│   └── whatsapp-api/       # Main WhatsApp API service
├── packages/               # Shared packages
│   ├── shared-utils/       # Common utilities
│   └── shared-types/       # TypeScript type definitions
├── tools/                  # Build tools and configurations
│   └── configs/           # Shared configurations (ESLint, Prettier, etc.)
├── docs/                   # Documentation
└── scripts/               # Build and deployment scripts
```

### Source Layout

`apps/whatsapp-api/src` is the canonical source tree for the gateway WhatsApp
API/client code. The repository root keeps `src` as a symlink to that directory
so legacy imports such as `require('./src/Client')` and older root-level tests
continue to work without maintaining a second copy of the same files.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Installation

```bash
# Install pnpm globally
npm install -g pnpm

# Install dependencies
pnpm install

# Setup workspace
pnpm setup
```

### Development

```bash
# Start all applications in development mode
pnpm dev

# Start specific application
pnpm dev --filter=whatsapp-api

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint code
pnpm lint

# Format code
pnpm format
```

## 📦 Packages

### Applications

- **whatsapp-api**: Main WhatsApp API service with enterprise features

### Shared Packages

- **shared-utils**: Common utilities and helper functions
- **shared-types**: TypeScript type definitions

## 🔧 Development Workflow

1. **Code**: Make changes in relevant packages
2. **Lint**: `pnpm lint` - Check code style
3. **Test**: `pnpm test` - Run test suites
4. **Build**: `pnpm build` - Build packages
5. **Format**: `pnpm format` - Format code

## 🚢 Deployment

### Docker

```bash
# Build Docker image
docker build -t whatsapp-api ./apps/whatsapp-api

# Run with docker-compose
docker-compose -f docker-compose.monorepo.yml up
```

### Environment Variables

Copy `.env.example` files in each app and configure:

```bash
cp apps/whatsapp-api/.env.example apps/whatsapp-api/.env
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

## 📋 Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development servers |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all code |
| `pnpm format` | Format all code |
| `pnpm clean` | Clean build artifacts |
| `pnpm setup` | Initial setup |

## 🏷️ Versioning

This project uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

## 📄 License

This project is licensed under the Apache-2.0 License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📖 [Documentation](./docs/)
- 🐛 [Issues](https://github.com/jubenitogarcia/WhatsApp/issues)
- 💬 [Discussions](https://github.com/jubenitogarcia/WhatsApp/discussions)
