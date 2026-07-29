# MCP inventory

The project adds a local Storybook MCP endpoint at `http://127.0.0.1:6006/mcp` when Storybook runs. `npm run storybook:mcp` completed a JSON-RPC `initialize` request with HTTP 200 on 2026-07-25. The official Inspector also completed `tools/list` against that local endpoint and discovered Storybook preview, documentation and story-test tools; use it only against this local endpoint.

Playwright MCP and Chrome DevTools MCP are registered globally through the WSL `admin` Node runtime with isolated browser profiles. `skincos-github-readonly` is registered at the official `https://api.githubcopilot.com/mcp/readonly` URL without a PAT, but this Codex host cannot complete its dynamic OAuth registration; it is not usable until GitHub/Codex supports that flow. Figma uses `https://mcp.figma.com/mcp`; complete its official OAuth manually before reading an authorized test file.
