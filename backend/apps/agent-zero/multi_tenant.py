from __future__ import annotations
from config import get_settings

settings = get_settings()

def resolve_tenant(host: str | None, headers) -> str:
    strategy = settings.tenant_strategy
    if strategy == 'host' and host:
        # assume subdomain. example tenant.example.com
        parts = host.split('.')
        if len(parts) > 2:  # subdomain present
            return parts[0]
    if strategy == 'header':
        return headers.get('X-Tenant-Id', settings.static_tenant_id)
    return settings.static_tenant_id
