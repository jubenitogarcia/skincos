"""Unified background daemon for Agent Zero (UI + Webhook + Worker).

Environment toggles:
  AGENT_DAEMON_DISABLE_UI=1        -> don't start Flask UI
  AGENT_DAEMON_DISABLE_WEBHOOK=1   -> don't start FastAPI webhook server
  AGENT_DAEMON_DISABLE_WORKER=1    -> don't start queue worker
  AGENT_DAEMON_WEBHOOK_PORT=4000   -> override webhook port

Run manually:
  python az_daemon.py
"""
from __future__ import annotations

import os, logging
import threading
import signal
import time
import asyncio
import uvicorn
from types import FrameType

from webhook_server import app as webhook_app  # FastAPI
from logging_config import setup_logging
setup_logging()
import worker  # worker.loop (memory)
from config import get_settings
settings = get_settings()
redis_worker_thread: threading.Thread | None = None

try:
    from run_ui import run as run_ui  # Flask UI runner
except Exception:
    run_ui = None  # type: ignore

STOP = False

logger = logging.getLogger("daemon")

def _log(msg: str):
    logger.info(msg)

def start_webhook():
    if os.getenv("AGENT_DAEMON_DISABLE_WEBHOOK"):
        _log("Webhook disabled by env")
        return
    port = int(os.getenv("AGENT_DAEMON_WEBHOOK_PORT") or os.getenv("AGENT_ZERO_PORT", "4000"))
    # check if port already in use
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        in_use = s.connect_ex(("127.0.0.1", port)) == 0
    if in_use:
        _log(f"Webhook port {port} already in use; skipping second start")
        return
    _log(f"Starting webhook on 0.0.0.0:{port}")
    config = uvicorn.Config(webhook_app, host="0.0.0.0", port=port, log_level="info")
    server = uvicorn.Server(config)
    server.run()

def start_worker():
    if os.getenv("AGENT_DAEMON_DISABLE_WORKER"):
        _log("Worker disabled by env")
        return
    if settings.queue_backend == 'redis':
        _log("Starting Redis MessageWorker loop")
        from queues.redis_queue import build_queue as build_redis_queue
        from storage.processed_events_store import build_store as build_dedupe_store
        from workers.message_worker import MessageWorker
        try:
            q = build_redis_queue(settings)
            dedupe_store = build_dedupe_store(settings)
            mw = MessageWorker(q, dedupe_store)
            asyncio.run(mw.start())
        except Exception as e:  # pragma: no cover
            _log(f"Redis worker init failed: {e}; falling back to memory worker")
            asyncio.run(worker.loop())
    else:
        _log("Starting memory worker loop")
        asyncio.run(worker.loop())

def start_ui():
    if os.getenv("AGENT_DAEMON_DISABLE_UI"):
        _log("UI disabled by env")
        return
    if run_ui is None:
        _log("UI module unavailable")
        return
    _log("Starting UI server")
    try:
        # ensure framework initialization (normally done in run_ui __main__)
        try:
            from apps.agent_zero_core.python.helpers import runtime, dotenv  # type: ignore
            runtime.initialize()
            dotenv.load_dotenv()
            # enforce default UI port if none provided (avoid accidental :80)
            if not os.getenv("WEB_UI_PORT"):
                os.environ["WEB_UI_PORT"] = "8080"
                _log("WEB_UI_PORT not set; defaulting to 8080")
        except Exception as e:  # noqa
            _log(f"UI pre-init warning: {e}")
        run_ui()
    except KeyboardInterrupt:
        pass

def handle_signal(signum: int, frame: FrameType | None):  # noqa
    global STOP
    _log(f"Signal {signum} received; shutting down...")
    STOP = True

def main():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    threads: list[threading.Thread] = []
    for target, name in [
        (start_ui, "ui"),
        (start_webhook, "webhook"),
        (start_worker, "worker"),
    ]:
        t = threading.Thread(target=target, name=f"daemon-{name}", daemon=True)
        t.start()
        threads.append(t)

    _log("All requested components started")
    try:
        while not STOP:
            time.sleep(1)
    finally:
        _log("Exiting daemon main loop")

if __name__ == "__main__":
    main()
