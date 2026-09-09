"""Private booking-executor/v1 receiver; no patient payload is persisted or logged."""

from __future__ import annotations

import base64
import fcntl
import hashlib
import hmac
import json
import os
import re
import sqlite3
import stat
import threading
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

CONTRACT = "booking-executor/v1"
DISPATCH_PATH = f"/{CONTRACT}/dispatch"
MAX_BODY_BYTES = 64 * 1024
AUTH_WINDOW_MS = 60_000
MAX_PENDING_MS = 30 * 60_000
UNITS = {"barrashoppingsul": "BarraShoppingSul", "novo-hamburgo": "Novo Hamburgo"}
HEADER_PREFIX = "x-skincos-booking-executor-"
AUTH_HEADERS = tuple(HEADER_PREFIX + key for key in ("version", "service", "ts", "nonce", "signature"))


class ExecutorError(Exception):
    def __init__(self, code: str, status: int = 503):
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class ExecutionResult:
    outcome: str
    verified_in_agenda: bool = False


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate_key")
        result[key] = value
    return result


def _text(value, maximum: int, minimum: int = 1) -> bool:
    return isinstance(value, str) and minimum <= len(value.strip()) and len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _payload(raw: bytes, allowed_units: frozenset[str]) -> tuple[str, dict, str]:
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(value, dict) or set(value) != {"contract", "deliveryId", "reservation"} or value["contract"] != CONTRACT:
            raise ValueError()
        delivery_id, reservation = value["deliveryId"], value["reservation"]
        if not isinstance(delivery_id, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{3,120}", delivery_id):
            raise ValueError()
        required = {"id", "idempotencyKey", "state", "unitSlug", "doctorSlug", "doctorName", "serviceId", "startAtMs", "endAtMs", "patient", "service"}
        if not isinstance(reservation, dict) or not required <= set(reservation) or set(reservation) - required - {"notes"}:
            raise ValueError()
        if reservation["state"] != "provisional" or reservation["unitSlug"] not in allowed_units:
            raise ValueError()
        if not all(_text(reservation[key], maximum) for key, maximum in (("id", 120), ("idempotencyKey", 200), ("doctorSlug", 80), ("doctorName", 160), ("serviceId", 120))):
            raise ValueError()
        start, end = reservation["startAtMs"], reservation["endAtMs"]
        if type(start) is not int or type(end) is not int or not 0 < start < end < 8_640_000_000_000_000 or end - start > 86_400_000:
            raise ValueError()
        patient, service = reservation["patient"], reservation["service"]
        if not isinstance(patient, dict) or not {"name", "whatsapp"} <= set(patient) or set(patient) - {"name", "whatsapp", "cpf"}:
            raise ValueError()
        if not _text(patient["name"], 160) or not isinstance(patient["whatsapp"], str) or not re.fullmatch(r"\+?[0-9]{10,20}", patient["whatsapp"]):
            raise ValueError()
        if "cpf" in patient and (not isinstance(patient["cpf"], str) or not re.fullmatch(r"[0-9]{11}", patient["cpf"])):
            raise ValueError()
        if not isinstance(service, dict) or "name" not in service or set(service) - {"name", "candidates"} or not _text(service["name"], 200):
            raise ValueError()
        candidates = service.get("candidates", [])
        if not isinstance(candidates, list) or len(candidates) > 20 or not all(_text(item, 200) for item in candidates):
            raise ValueError()
        if "notes" in reservation:
            notes = reservation["notes"]
            if not isinstance(notes, str) or len(notes) > 2000 or any(ord(c) < 32 and c not in "\t\r\n" for c in notes):
                raise ValueError()
        fingerprint = hashlib.sha256(json.dumps(reservation, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
        return delivery_id, reservation, fingerprint
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError):
        raise ExecutorError("booking_executor_payload_invalid", 400) from None


class ExecutorLedger:
    """One process owns this private file. SQL transactions arbitrate its threads."""

    def __init__(self, database_path: Path):
        self.path = Path(database_path)
        self._owner_fd = None
        try:
            root = Path(__file__).resolve().parents[3]
            if not self.path.is_absolute() or self.path.parent.resolve() != self.path.parent or self.path.is_relative_to(root):
                raise ValueError()
            parent = self.path.parent.stat()
            if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
                raise ValueError()
            flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW
            self._owner_fd = os.open(str(self.path) + ".owner", flags, 0o600)
            self._check_private(os.fstat(self._owner_fd))
            fcntl.flock(self._owner_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fd = os.open(self.path, flags, 0o600)
            try:
                self._check_private(os.fstat(fd))
            finally:
                os.close(fd)
            with self._connection() as db:
                db.executescript("""
                    CREATE TABLE IF NOT EXISTS executor_deliveries (
                        delivery_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL CHECK(status IN ('accepted','running','confirmed','failed','manual_review')),
                        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS executor_nonces (
                        nonce TEXT PRIMARY KEY, expires_at_ms INTEGER NOT NULL
                    );
                    CREATE TRIGGER IF NOT EXISTS executor_delivery_identity_immutable
                    BEFORE UPDATE OF delivery_id,fingerprint,created_at_ms ON executor_deliveries
                    BEGIN SELECT RAISE(ABORT,'executor_identity_immutable'); END;
                    CREATE TRIGGER IF NOT EXISTS executor_delivery_terminal_immutable
                    BEFORE UPDATE ON executor_deliveries WHEN OLD.status IN ('confirmed','failed','manual_review')
                    BEGIN SELECT RAISE(ABORT,'executor_terminal_immutable'); END;
                """)
                # An admitted execution may have reached EF before process death.
                # No recovered row ever causes a second external submission.
                db.execute("UPDATE executor_deliveries SET status='manual_review',updated_at_ms=? WHERE status IN ('accepted','running')", (int(time.time() * 1000),))
        except Exception:
            self.close()
            raise ExecutorError("booking_executor_ledger_unavailable") from None

    @staticmethod
    def _check_private(info):
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise ValueError()

    @contextmanager
    def _connection(self):
        self._check_private(self.path.lstat())
        db = sqlite3.connect(self.path, timeout=1)
        try:
            db.execute("PRAGMA synchronous=FULL")
            with db:
                yield db
        finally:
            db.close()

    def admit(self, delivery_id, fingerprint, nonce, now_ms):
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM executor_nonces WHERE expires_at_ms < ?", (now_ms,))
            try:
                db.execute("INSERT INTO executor_nonces VALUES (?,?)", (nonce, now_ms + 2 * AUTH_WINDOW_MS))
            except sqlite3.IntegrityError:
                raise ExecutorError("booking_executor_replay", 409) from None
            row = db.execute("SELECT fingerprint,status,created_at_ms FROM executor_deliveries WHERE delivery_id=?", (delivery_id,)).fetchone()
            if row:
                if not hmac.compare_digest(row[0], fingerprint):
                    raise ExecutorError("booking_executor_delivery_conflict", 409)
                status = row[1]
                if status in {"accepted", "running"} and now_ms - row[2] >= MAX_PENDING_MS:
                    db.execute("UPDATE executor_deliveries SET status='manual_review',updated_at_ms=? WHERE delivery_id=?", (now_ms, delivery_id))
                    status = "manual_review"
                return status, False
            if db.execute("SELECT COUNT(*) FROM executor_deliveries WHERE status IN ('accepted','running')").fetchone()[0] >= 16:
                raise ExecutorError("booking_executor_capacity_unavailable")
            db.execute("INSERT INTO executor_deliveries VALUES (?,?,'accepted',?,?)", (delivery_id, fingerprint, now_ms, now_ms))
            return "accepted", True

    def start(self, delivery_id, now_ms):
        with self._connection() as db:
            return db.execute("UPDATE executor_deliveries SET status='running',updated_at_ms=? WHERE delivery_id=? AND status='accepted' AND created_at_ms>?", (now_ms, delivery_id, now_ms - MAX_PENDING_MS)).rowcount == 1

    def finish(self, delivery_id, status, now_ms):
        if status not in {"confirmed", "failed", "manual_review"}:
            raise ExecutorError("booking_executor_outcome_invalid")
        with self._connection() as db:
            db.execute("UPDATE executor_deliveries SET status=?,updated_at_ms=? WHERE delivery_id=? AND status IN ('accepted','running')", (status, now_ms, delivery_id))

    def close(self):
        if self._owner_fd is not None:
            os.close(self._owner_fd)
            self._owner_fd = None


class BookingExecutor:
    def __init__(self, *, ledger: ExecutorLedger, secret: str, allowed_units, execute: Callable,
                 now=lambda: int(time.time() * 1000), launch=None, execution_lock=None):
        if not isinstance(secret, str) or len(secret) < 32 or not allowed_units or not set(allowed_units) <= set(UNITS):
            raise ExecutorError("booking_executor_configuration_invalid")
        self.ledger, self._secret, self._execute, self._now = ledger, secret, execute, now
        self._allowed_units = frozenset(allowed_units)
        self._launch = launch or (lambda callback: threading.Thread(target=callback, daemon=True).start())
        self._execution_lock = execution_lock or threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self._closing = False
        self._pending_callbacks = 0

    def dispatch(self, raw: bytes, headers: dict, *, pathname=DISPATCH_PATH):
        try:
            if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BODY_BYTES:
                raise ExecutorError("booking_executor_payload_invalid", 400)
            now_ms = self._now()
            ts, nonce, signature = (headers.get(HEADER_PREFIX + name, "") for name in ("ts", "nonce", "signature"))
            if pathname != DISPATCH_PATH or headers.get(HEADER_PREFIX + "version") != "v1" or headers.get(HEADER_PREFIX + "service") != "booking":
                raise ExecutorError("booking_executor_unauthorized", 401)
            if not isinstance(ts, str) or not re.fullmatch(r"[0-9]{13,16}", ts) or abs(now_ms - int(ts)) > AUTH_WINDOW_MS:
                raise ExecutorError("booking_executor_unauthorized", 401)
            if not isinstance(nonce, str) or not re.fullmatch(r"[A-Za-z0-9._-]{16,128}", nonce) or not isinstance(signature, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", signature):
                raise ExecutorError("booking_executor_unauthorized", 401)
            canonical = ".".join((CONTRACT, ts, nonce, "POST", pathname, "booking", _b64url(hashlib.sha256(raw).digest())))
            expected = _b64url(hmac.new(self._secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).digest())
            if not hmac.compare_digest(signature, expected):
                raise ExecutorError("booking_executor_unauthorized", 401)
            delivery_id, reservation, fingerprint = _payload(raw, self._allowed_units)
            with self._lifecycle_lock:
                if self._closing:
                    raise ExecutorError("booking_executor_unavailable")
                status, admitted = self.ledger.admit(delivery_id, fingerprint, nonce, now_ms)
                if admitted:
                    self._pending_callbacks += 1
            if admitted:
                try:
                    self._launch(lambda: self._run(delivery_id, reservation))
                except Exception:
                    try:
                        self.ledger.finish(delivery_id, "manual_review", self._now())
                    finally:
                        self._callback_finished()
                    status = "manual_review"
            if status in {"accepted", "running"}:
                return 202, {"ok": True, "contract": CONTRACT, "status": "pending", "retryAfterMs": 1000}
            return 200, {"ok": True, "contract": CONTRACT, "outcome": status, "providerReference": None,
                         "detail": {"code": "agenda_readback_verified" if status == "confirmed" else "executor_review_required"}}
        except ExecutorError as exc:
            return exc.status, {"ok": False, "error": exc.code}
        except Exception:
            return 503, {"ok": False, "error": "booking_executor_unavailable"}

    def _run(self, delivery_id, reservation):
        try:
            with self._execution_lock:
                with self._lifecycle_lock:
                    if self._closing:
                        self.ledger.finish(delivery_id, "manual_review", self._now())
                        return
                if not self.ledger.start(delivery_id, self._now()):
                    return
                result = self._execute(reservation)
                # A Selenium request being accepted, finishing a dry run, or a
                # disappeared dialog alone is never confirmation of an appointment.
                outcome = "confirmed" if isinstance(result, ExecutionResult) and result.outcome == "confirmed" and result.verified_in_agenda else "manual_review"
                self.ledger.finish(delivery_id, outcome, self._now())
        except Exception:
            try:
                self.ledger.finish(delivery_id, "manual_review", self._now())
            except Exception:
                pass  # Durable pending intent prevents a second execution.
        finally:
            reservation.clear()
            self._callback_finished()

    def _callback_finished(self):
        with self._lifecycle_lock:
            self._pending_callbacks -= 1
            if self._closing and self._pending_callbacks == 0:
                self.ledger.close()

    def close(self):
        """Stop admissions; retain process ownership until every callback exits."""
        with self._lifecycle_lock:
            self._closing = True
            if self._pending_callbacks == 0:
                self.ledger.close()


def execute_existing_ef_booking(reservation: dict, *, cfg, debug_dir: Path) -> ExecutionResult:
    from .auth import Credentials, login_and_select_unit
    from .booking import BookingRequest, execute_booking
    from .core import create_driver
    from .private_operation import private_operation

    patient = reservation["patient"]
    payload = {"event": "booking.created", "booking": {
        **reservation, "unitName": UNITS[reservation["unitSlug"]], "patientName": patient["name"],
        "whatsapp": patient["whatsapp"], "cpf": patient.get("cpf", ""),
    }}
    with private_operation():
        request = BookingRequest.from_payload(payload)
        driver = None
        try:
            driver = create_driver(headless=cfg.headless, user_data_dir=cfg.chrome_user_data_dir)
            if not login_and_select_unit(driver, base_url=cfg.base_url, creds=Credentials(cfg.email, cfg.password),
                                         unit_name=request.unit_name, timeout_seconds=cfg.timeout_seconds):
                return ExecutionResult("manual_review")
            result = execute_booking(driver, reception_url=cfg.reception_url, request=request,
                                     debug_dir=debug_dir, timeout_seconds=cfg.timeout_seconds)
            return ExecutionResult("confirmed", result.ok is True and result.verified_in_agenda is True and not request.dry_run)
        finally:
            if driver is not None:
                try:
                    driver.quit()
                except Exception:
                    pass


def configured_executor(*, cfg, debug_dir: Path):
    if os.getenv("BOOKING_EXECUTOR_V1_ENABLED") != "true":
        return None
    secret = os.getenv("BOOKING_EXECUTOR_HMAC_KEY", "")
    units = [value.strip() for value in os.getenv("BOOKING_EXECUTOR_V1_UNITS", "").split(",") if value.strip()]
    database = os.getenv("BOOKING_EXECUTOR_V1_LEDGER", "")
    if not database or len(secret) < 32 or not units or not set(units) <= set(UNITS):
        raise ExecutorError("booking_executor_configuration_invalid")
    from .booking import BOOKING_LOCK

    ledger = ExecutorLedger(Path(database))
    return BookingExecutor(ledger=ledger, secret=secret, allowed_units=units,
                           execute=lambda reservation: execute_existing_ef_booking(reservation, cfg=cfg, debug_dir=debug_dir),
                           execution_lock=BOOKING_LOCK)
