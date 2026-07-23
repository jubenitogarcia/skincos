# Test runtime SDK

An integration smoke must load its browser/runtime dependency from its own
package or from an explicitly supplied private test-runtime path. It must not
resolve another module's `node_modules` tree. The Finance staging smoke remains
on the legacy allowlist until its runner receives a dedicated Playwright
dependency.
