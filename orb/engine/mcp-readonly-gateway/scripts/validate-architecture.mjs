import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await readFile(path.join(root, 'server.mjs'), 'utf8');
const unit = await readFile(path.join(root, 'systemd', 'skincos-orb-mcp-readonly.service'), 'utf8');
const source = await readFile(path.join(root, 'lib', 'sanitize.mjs'), 'utf8');

assert.match(server, /127\.0\.0\.1/);
assert.match(server, /const TOOLS = \[/);
assert.doesNotMatch(server, /execute_workflow/);
assert.match(server, /MAX_CONCURRENT_REQUESTS/);
assert.match(server, /tool_timeout_or_client_disconnect/);
assert.match(server, /hasSensitiveMaterial\(safeOutput\)/);
assert.match(server, /default_transaction_read_only=on/);
assert.doesNotMatch(server, /\b(?:insert|update|delete|alter|drop|truncate)\s+/i);
assert.match(unit, /WorkingDirectory=\/opt\/skincos\/current\/source\/orb\/engine\/mcp-readonly-gateway/);
assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/skincos\/current\/source\/orb\/engine\/mcp-readonly-gateway\/server\.mjs/);
assert.match(source, /redacted-signed-url/);
console.log('MCP read-only gateway architecture validation passed.');
