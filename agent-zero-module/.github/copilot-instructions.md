# Agent Zero - AI Agent Framework

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

- **Bootstrap and validate repository (CRITICAL - ALWAYS RUN FIRST):**
  - `make info` -- Check environment information
  - `npm install` -- NEVER CANCEL: Takes ~3 minutes to complete. Set timeout to 300+ seconds.
  - `make clean` -- Clean artifacts (fast, <1 second)

- **NEVER attempt full Python installation via `make install` or `pip install -e .`** -- This fails due to network timeouts and dependency conflicts with openai-whisper and langchain packages.

- **For Python development (minimal dependencies only):**
  - `pip3 install --user pytest httpx fastapi uvicorn prometheus-client redis` -- Install basic dependencies for testing
  - `PYTHONPATH=/home/runner/work/agent-zero/agent-zero pytest tests/test_signature.py -v` -- Run working tests (fast, <1 second)

- **Docker deployment (RECOMMENDED APPROACH):**
  - `docker pull agent0ai/agent-zero` -- NEVER CANCEL: Takes ~1.3 minutes. Set timeout to 240+ seconds.
  - `docker run -p 50001:80 agent0ai/agent-zero` -- Start complete application stack
  - Access at http://localhost:50001

- **DO NOT attempt Docker builds** -- `docker build` fails due to TLS certificate issues with Python package installations.

- **DO NOT run `npm run build` or nx commands** -- ESLint configuration has format incompatibilities that prevent builds.

## Validation

- **Always test Docker functionality after making changes:**
  - `docker pull agent0ai/agent-zero` -- Verify image availability
  - `timeout 60 docker run -p 50001:80 agent0ai/agent-zero` -- Test container startup
  - Check for successful supervisord initialization messages

- **Run basic Python tests to validate core functionality:**
  - `PYTHONPATH=/home/runner/work/agent-zero/agent-zero pytest tests/test_signature.py -v` -- Test webhook signature validation
  - Tests require: pytest, httpx, fastapi, uvicorn, prometheus-client, redis

- **ALWAYS run `make clean` before committing changes** to remove build artifacts.

- **TIMING EXPECTATIONS - NEVER CANCEL:**
  - Node.js installation: 3 minutes (timeout: 300+ seconds)
  - Docker pull: 1.3 minutes (timeout: 240+ seconds) 
  - Python tests: <1 second
  - Make clean: <1 second

## Common Issues and Workarounds

- **Pip installation failures:** Use Docker deployment instead of local Python installation
- **ESLint build errors:** Skip JavaScript builds, focus on Python/Docker workflow
- **Network timeouts:** Allow sufficient timeout for Docker operations
- **Missing Python dependencies:** Install only minimal subset needed for testing

## Repository Structure

- **`/python`** -- Core Python agent framework
- **`/agents`** -- Agent implementations  
- **`/webui`** -- Web interface components
- **`/docker`** -- Docker configuration and build files
- **`/tests`** -- Python test suite (pytest)
- **`/scripts`** -- Helper scripts for development
- **`Makefile`** -- Convenience commands for development
- **`package.json`** -- Node.js monorepo configuration (nx workspace)
- **`pyproject.toml`** -- Python project configuration
- **`smoke.sh`** -- Integration test script for webhook functionality

## Key Services

- **Agent Zero Core** -- Main AI agent framework
- **WebUI** -- Web interface for agent interaction
- **Webhook Server** -- WhatsApp integration endpoint
- **Worker** -- Background task processing
- **CRM** -- Customer relationship management
- **WhatsApp Gateway** -- Messaging integration

## Development Workflow

1. **Environment Setup:** Run `make info` and `npm install`
2. **Clean State:** Run `make clean` before starting work
3. **Docker Validation:** Test `docker pull agent0ai/agent-zero`
4. **Code Changes:** Make minimal, focused changes
5. **Testing:** Run `pytest tests/test_signature.py -v` with minimal deps
6. **Docker Testing:** Verify container still starts correctly
7. **Clean Up:** Run `make clean` before committing

## Critical Commands Reference

```bash
# Environment validation
make info                    # Check system requirements

# Dependencies (REQUIRED)
npm install                  # 3 minutes - NEVER CANCEL
pip3 install --user pytest httpx fastapi uvicorn prometheus-client redis

# Docker operations (RECOMMENDED)
docker pull agent0ai/agent-zero    # 1.3 minutes - NEVER CANCEL  
docker run -p 50001:80 agent0ai/agent-zero

# Testing
PYTHONPATH=/home/runner/work/agent-zero/agent-zero pytest tests/test_signature.py -v

# Cleanup
make clean                   # Always run before commit
```

## DO NOT Commands

- `make install` -- Fails with network timeouts
- `pip install -e .` -- Fails with dependency conflicts  
- `npm run build` -- Fails with ESLint configuration errors
- `docker build` -- Fails with TLS certificate issues
- Cancel long-running operations (Docker, npm) -- They need full time to complete

## Troubleshooting

- **ModuleNotFoundError in tests:** Install minimal Python dependencies listed above
- **Docker pull timeouts:** Increase timeout to 240+ seconds and retry
- **npm install issues:** Ensure timeout is 300+ seconds, warnings are normal
- **Build failures:** Use Docker deployment instead of local builds