from __future__ import annotations

import json
import os
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .auth import Credentials, configure_file_logging, log, login_and_select_unit
from .booking import BOOKING_LOCK, BookingError, BookingRequest, BookingResult, execute_booking
from .core import create_driver, load_config


@dataclass
class BookingJob:
    id: str
    created_at: str
    status: str = "queued"
    payload: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] | None = None
    error: str = ""
    started_at: str = ""
    ended_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "createdAt": self.created_at,
            "status": self.status,
            "payload": self.payload,
            "result": self.result,
            "error": self.error,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
        }


class BookingJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, BookingJob] = {}
        self._lock = threading.Lock()

    def create(self, payload: dict[str, Any]) -> BookingJob:
        job = BookingJob(
            id=uuid.uuid4().hex,
            created_at=datetime.now().isoformat(timespec="seconds"),
            payload=payload,
        )
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> BookingJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **changes: Any) -> BookingJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            for key, value in changes.items():
                setattr(job, key, value)
            return job


class BookingWorker:
    def __init__(self, *, store: BookingJobStore, debug_dir: Path) -> None:
        self.store = store
        self.debug_dir = debug_dir

    def submit(self, job: BookingJob) -> None:
        thread = threading.Thread(target=self._run, args=(job.id,), daemon=True)
        thread.start()

    def _run(self, job_id: str) -> None:
        job = self.store.get(job_id)
        if job is None:
            return
        self.store.update(job_id, status="running", started_at=datetime.now().isoformat(timespec="seconds"))
        cfg = load_config()
        driver = None
        try:
            request = BookingRequest.from_payload(job.payload, default_unit_name=cfg.unit_name)
            log(f"Starting booking job {job_id} for {request.client_name} ({request.unit_name})")
            with BOOKING_LOCK:
                driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
                creds = Credentials(cfg.email, cfg.password)
                if not login_and_select_unit(
                    driver,
                    base_url=cfg.base_url,
                    creds=creds,
                    unit_name=request.unit_name,
                    timeout_seconds=cfg.timeout_seconds,
                ):
                    raise BookingError("login or unit selection failed")
                result = execute_booking(
                    driver,
                    reception_url=cfg.reception_url,
                    request=request,
                    debug_dir=self.debug_dir,
                    timeout_seconds=cfg.timeout_seconds,
                )
            self.store.update(
                job_id,
                status="completed",
                result=result.to_dict(),
                ended_at=datetime.now().isoformat(timespec="seconds"),
            )
            log(f"Booking job {job_id} completed")
        except Exception as exc:
            self.store.update(
                job_id,
                status="failed",
                error=str(exc),
                ended_at=datetime.now().isoformat(timespec="seconds"),
            )
            log(f"Booking job {job_id} failed: {exc}")
        finally:
            if driver is not None:
                try:
                    driver.quit()
                except Exception:
                    pass


class BookingRequestHandler(BaseHTTPRequestHandler):
    server_version = "EFAgendaBooking/1.0"

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._write_json(HTTPStatus.OK, {"ok": True, "service": "agenda-booking"})
            return
        if parsed.path.startswith("/api/agenda/book/"):
            job_id = parsed.path.rsplit("/", 1)[-1]
            job = self.server.job_store.get(job_id)  # type: ignore[attr-defined]
            if job is None:
                self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "job not found"})
                return
            self._write_json(HTTPStatus.OK, {"ok": True, "job": job.to_dict()})
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/agenda/book":
            self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not found"})
            return
        if not self._authorized():
            self._write_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("content-length") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid json body"})
            return
        if not isinstance(payload, dict):
            self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "payload must be an object"})
            return
        try:
            BookingRequest.from_payload(payload, default_unit_name=self.server.cfg.unit_name)  # type: ignore[attr-defined]
        except Exception as exc:
            self._write_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
            return
        job = self.server.job_store.create(payload)  # type: ignore[attr-defined]
        self.server.worker.submit(job)  # type: ignore[attr-defined]
        self._write_json(
            HTTPStatus.ACCEPTED,
            {
                "ok": True,
                "jobId": job.id,
                "status": job.status,
                "pollUrl": f"/api/agenda/book/{job.id}",
            },
        )

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        log(f"booking-api {self.address_string()} - {format % args}")

    def _authorized(self) -> bool:
        bearer_token = (os.getenv("EF_BOOKING_API_TOKEN") or "").strip()
        webhook_secret = (os.getenv("EF_BOOKING_WEBHOOK_SECRET") or bearer_token).strip()
        if not bearer_token and not webhook_secret:
            return True
        auth_header = (self.headers.get("authorization") or "").strip()
        if bearer_token and auth_header == f"Bearer {bearer_token}":
            return True
        secret_header = (self.headers.get("x-booking-webhook-secret") or "").strip()
        return bool(webhook_secret and secret_header == webhook_secret)

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BookingHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address, RequestHandlerClass, *, cfg, job_store, worker):
        super().__init__(server_address, RequestHandlerClass)
        self.cfg = cfg
        self.job_store = job_store
        self.worker = worker


def run_booking_server() -> int:
    cfg = load_config()
    configure_file_logging(cfg.output_dir, prefix="booking_api")
    host = os.getenv("EF_BOOKING_API_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("EF_BOOKING_API_PORT", "8765"))
    debug_dir = Path(os.getenv("EF_DEBUG_DIR", str(cfg.debug_dir))).expanduser()
    debug_dir.mkdir(parents=True, exist_ok=True)

    store = BookingJobStore()
    worker = BookingWorker(store=store, debug_dir=debug_dir)
    server = BookingHTTPServer((host, port), BookingRequestHandler, cfg=cfg, job_store=store, worker=worker)

    log(f"Booking API listening on http://{host}:{port}")
    if os.getenv("EF_BOOKING_API_TOKEN", "").strip():
        log("Booking API auth: Bearer token enabled")
    elif os.getenv("EF_BOOKING_WEBHOOK_SECRET", "").strip():
        log("Booking API auth: x-booking-webhook-secret enabled")
    else:
        log("WARNING: EF_BOOKING_API_TOKEN is not configured; endpoint is unsecured")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Booking API interrupted; shutting down")
    finally:
        server.server_close()
    return 0
