import logging, os, sys
from logging.handlers import RotatingFileHandler

LOG_LEVEL = os.getenv("AGENT_LOG_LEVEL", "INFO").upper()
LOG_DIR = os.getenv("AGENT_LOG_DIR", "logs")
LOG_FILE = os.getenv("AGENT_LOG_FILE", "agent.log")

def setup_logging():
    if getattr(setup_logging, "_configured", False):
        return
    os.makedirs(LOG_DIR, exist_ok=True)
    fmt = logging.Formatter('[%(asctime)s] %(levelname)s %(name)s %(threadName)s: %(message)s')
    stream_h = logging.StreamHandler(sys.stdout)
    stream_h.setFormatter(fmt)
    file_h = RotatingFileHandler(os.path.join(LOG_DIR, LOG_FILE), maxBytes=1_000_000, backupCount=5)
    file_h.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(LOG_LEVEL)
    # Clear existing to avoid duplicates if reloaded
    root.handlers.clear()
    root.addHandler(stream_h)
    root.addHandler(file_h)
    setup_logging._configured = True  # type: ignore
