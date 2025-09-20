import os
from functools import lru_cache

class Settings:
    def __init__(self) -> None:
        self.redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/1")
        self.queue_backend = os.getenv("QUEUE_BACKEND", "memory")
        self.intent_default_reply = os.getenv("INTENT_DEFAULT_REPLY", "Desculpe, pode detalhar?")
        self.event_dedupe_ttl = int(os.getenv("EVENT_DEDUPE_TTL_SECONDS", "300"))
        self.worker_visibility_timeout = int(os.getenv("WORKER_VISIBILITY_TIMEOUT", "30"))
        self.worker_max_attempts = int(os.getenv("WORKER_MAX_ATTEMPTS", "3"))
        self.log_json = os.getenv("LOG_JSON", "0") == "1"
        self.metrics_enabled = os.getenv("METRICS_ENABLED", "1") == "1"
        self.tenant_strategy = os.getenv("TENANT_STRATEGY", "static")
        self.static_tenant_id = os.getenv("STATIC_TENANT_ID", "default")
        self.whatsapp_base_url = os.getenv("WHATSAPP_BASE_URL", "")
        self.whatsapp_api_key = os.getenv("WHATSAPP_API_KEY", "")

@lru_cache()
def get_settings() -> Settings:
    return Settings()
