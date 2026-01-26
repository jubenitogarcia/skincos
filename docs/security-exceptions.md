# Security Exceptions

## CVE-2026-0994 (protobuf)

- **Impact**: DoS via deep recursion in `google.protobuf.json_format.ParseDict()` with nested `Any` messages.
- **Status**: No fixed version available upstream (as of protobuf `6.33.4`).
- **Scope**: Python dependencies pulled by Google API clients (`google-api-python-client`).
- **Mitigation**: The codebase does not use `ParseDict()` on untrusted input; avoid introducing it in public/request paths.
- **Next action**: Monitor upstream for a fixed release and update pins when available.
