"""Synthetic-only tests. No EF login, browser, or real booking is performed."""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from espacofacial.booking_executor import (
    AUTH_WINDOW_MS,
    CONTRACT,
    DISPATCH_PATH,
    HEADER_PREFIX,
    MAX_BODY_BYTES,
    MAX_PENDING_MS,
    BookingExecutor,
    ExecutionResult,
    ExecutorError,
    ExecutorLedger,
    configured_executor,
    execute_existing_ef_booking,
)

SECRET = "synthetic-executor-key-32-bytes-minimum"
NOW = 1788955200000


def reservation():
    return {
        "id": "synthetic-reservation-1",
        "idempotencyKey": "synthetic-key-1",
        "state": "provisional",
        "unitSlug": "barrashoppingsul",
        "doctorSlug": "synthetic-doctor",
        "doctorName": "Profissional Sintetico",
        "serviceId": "avaliacao",
        "startAtMs": NOW + 86_400_000,
        "endAtMs": NOW + 88_200_000,
        "patient": {"name": "Paciente Sintetico", "whatsapp": "5500000000000", "cpf": "00000000000"},
        "service": {"name": "Avaliação", "candidates": ["Avaliação Facial"]},
        "notes": "Apenas simulacao",
    }


def encode(payload=None, delivery_id="synthetic-delivery-1"):
    return json.dumps({"contract": CONTRACT, "deliveryId": delivery_id, "reservation": payload or reservation()},
                      separators=(",", ":"), ensure_ascii=False).encode()


def signed(raw, nonce="synthetic-nonce-0001", ts=NOW, secret=SECRET):
    def b64(value):
        return base64.urlsafe_b64encode(value).decode().rstrip("=")
    digest = b64(hashlib.sha256(raw).digest())
    canonical = f"{CONTRACT}.{ts}.{nonce}.POST.{DISPATCH_PATH}.booking.{digest}"
    return {HEADER_PREFIX + key: value for key, value in {
        "version": "v1", "service": "booking", "ts": str(ts), "nonce": nonce,
        "signature": b64(hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).digest()),
    }.items()}


class ExecutorFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="booking-executor-synthetic-")
        self.path = Path(self.temp.name) / "executor.sqlite"
        self.ledger = ExecutorLedger(self.path)
        self.now = NOW
        self.queue = []
        self.execute = Mock(return_value=ExecutionResult("confirmed", True))
        self.executor = self.make_executor()
        self.nonce = 0

    def tearDown(self):
        self.ledger.close()
        self.temp.cleanup()

    def make_executor(self, **kwargs):
        return BookingExecutor(ledger=self.ledger, secret=SECRET, allowed_units=["barrashoppingsul"],
                               execute=self.execute, now=lambda: self.now, launch=self.queue.append, **kwargs)

    def dispatch(self, raw=None):
        raw = raw or encode()
        self.nonce += 1
        return self.executor.dispatch(raw, signed(raw, nonce=f"synthetic-nonce-{self.nonce:04d}", ts=self.now))


class ExecutorTests(ExecutorFixture):

    def test_async_admission_retry_terminal_readback_and_no_patient_storage(self):
        self.assertEqual(self.dispatch()[0], 202)
        self.assertEqual(self.dispatch()[0], 202)
        self.assertEqual(len(self.queue), 1)
        self.execute.assert_not_called()
        self.queue.pop()()
        status, result = self.dispatch()
        self.assertEqual(status, 200)
        self.assertEqual(result["outcome"], "confirmed")
        self.assertEqual(result["detail"]["code"], "agenda_readback_verified")
        self.assertIsNone(result["providerReference"])
        self.assertEqual(self.execute.call_count, 1)
        with sqlite3.connect(self.path) as db:
            dump = "\n".join(db.iterdump())
        for private_value in ("Paciente", "5500000000000", "00000000000", "Apenas simulacao", "Avaliação"):
            self.assertNotIn(private_value, dump)
            self.assertNotIn(private_value, json.dumps(result))
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_replay_is_rejected_but_new_nonce_can_read_same_delivery(self):
        raw = encode()
        headers = signed(raw)
        self.assertEqual(self.executor.dispatch(raw, headers)[0], 202)
        self.assertEqual(self.executor.dispatch(raw, headers),
                         (409, {"ok": False, "error": "booking_executor_replay"}))
        self.nonce = 1
        self.assertEqual(self.dispatch()[0], 202)
        self.assertEqual(len(self.queue), 1)

    def test_signature_matches_independent_website_javascript_vector(self):
        raw = b'{"contract":"booking-executor/v1","deliveryId":"synthetic-vector","reservation":{}}'
        headers = signed(raw)
        self.assertEqual(headers[HEADER_PREFIX + "signature"], "tJhoUm2-wZyKkoB6r9ri5dxVi21RkUi7sENzNg9Qyh4")
        self.assertEqual(self.executor.dispatch(raw, headers)[0], 400)  # authenticated, invalid shape

    def test_bad_auth_never_admits(self):
        raw = encode()
        scenarios = [({}, raw), (signed(raw, ts=NOW - AUTH_WINDOW_MS - 1), raw),
                     (signed(raw, ts=NOW + AUTH_WINDOW_MS + 1), raw),
                     (signed(raw, secret="wrong-synthetic-secret"), raw), (signed(raw), raw + b" ")]
        for field, value in (("version", "v2"), ("service", "other"), ("nonce", "short"), ("ts", "NaN")):
            headers = signed(raw)
            headers[HEADER_PREFIX + field] = value
            scenarios.append((headers, raw))
        for headers, body in scenarios:
            with self.subTest(headers=headers):
                self.assertEqual(self.executor.dispatch(body, headers)[0], 401)
        self.assertEqual(self.queue, [])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM executor_deliveries").fetchone()[0], 0)

    def test_payload_shape_rejected_before_admission(self):
        malformed = [b"not-json", b'{"contract":"booking-executor/v1","contract":"booking-executor/v1"}',
                     b"x" * (MAX_BODY_BYTES + 1)]
        for key, value in (("unitSlug", "unknown"), ("state", "confirmed"), ("startAtMs", True),
                           ("patient", {"name": "Paciente Sintetico", "whatsapp": "+55 (00)"}),
                           ("service", {"name": "Synthetic", "candidates": ["x"] * 21}),
                           ("request", {"private": True}), ("doctorName", "")):
            body = reservation()
            body[key] = value
            malformed.append(encode(body))
        for raw in malformed:
            with self.subTest(raw=raw[:70]):
                self.assertEqual(self.dispatch(raw)[0], 400)
        self.assertEqual(self.queue, [])

    def test_fingerprint_conflict_never_overwrites_or_executes(self):
        self.assertEqual(self.dispatch()[0], 202)
        changed = reservation()
        changed["patient"]["name"] = "Outro Paciente Sintetico"
        self.assertEqual(self.dispatch(encode(changed)),
                         (409, {"ok": False, "error": "booking_executor_delivery_conflict"}))
        self.assertEqual(len(self.queue), 1)

    def test_fingerprint_ignores_json_key_order(self):
        raw = encode()
        self.assertEqual(self.dispatch(raw)[0], 202)
        reordered = json.dumps(json.loads(raw), sort_keys=True).encode()
        self.assertEqual(self.dispatch(reordered)[0], 202)
        self.assertEqual(len(self.queue), 1)

    def test_false_verified_and_provider_exception_are_manual_review(self):
        for index, result in enumerate((ExecutionResult("confirmed", False), {"ok": True}, RuntimeError("PRIVATE provider response"))):
            self.execute.side_effect = result if isinstance(result, Exception) else None
            self.execute.return_value = result
            raw = encode(delivery_id=f"synthetic-outcome-{index}")
            self.assertEqual(self.dispatch(raw)[0], 202)
            self.queue.pop()()
            status, body = self.dispatch(raw)
            self.assertEqual((status, body["outcome"]), (200, "manual_review"))
            self.assertNotIn("PRIVATE", json.dumps(body))

    def test_restart_converts_uncertain_to_terminal_and_retains_replay(self):
        raw = encode()
        headers = signed(raw)
        self.assertEqual(self.executor.dispatch(raw, headers)[0], 202)
        self.ledger.close()  # simulate process death, without running the queued callback
        self.queue.clear()
        self.ledger = ExecutorLedger(self.path)
        self.executor = self.make_executor()
        self.assertEqual(self.executor.dispatch(raw, headers)[0], 409)
        self.nonce = 1
        self.assertEqual(self.dispatch()[1]["outcome"], "manual_review")
        self.assertEqual(self.queue, [])
        self.execute.assert_not_called()

    def test_single_process_ownership_and_private_file_requirements(self):
        with self.assertRaisesRegex(ExecutorError, "ledger_unavailable"):
            ExecutorLedger(self.path)
        self.ledger.close()
        self.path.chmod(0o644)
        with self.assertRaisesRegex(ExecutorError, "ledger_unavailable"):
            ExecutorLedger(self.path)
        self.path.chmod(0o600)
        alias = self.path.parent / "alias.sqlite"
        alias.symlink_to(self.path)
        with self.assertRaisesRegex(ExecutorError, "ledger_unavailable"):
            ExecutorLedger(alias)
        self.path.parent.chmod(0o755)
        with self.assertRaisesRegex(ExecutorError, "ledger_unavailable"):
            ExecutorLedger(self.path)
        self.path.parent.chmod(0o700)

    def test_concurrent_retries_admit_one_callback(self):
        barrier = threading.Barrier(8)
        results = []
        raw = encode()

        def call(index):
            barrier.wait()
            results.append(self.executor.dispatch(raw, signed(raw, nonce=f"synthetic-parallel-{index:04d}"))[0])

        threads = [threading.Thread(target=call, args=(index,)) for index in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        self.assertEqual(sorted(results), [202] * 8)
        self.assertEqual(len(self.queue), 1)

    def test_expired_queued_work_never_executes(self):
        self.assertEqual(self.dispatch()[0], 202)
        self.now += MAX_PENDING_MS
        self.assertEqual(self.dispatch()[1]["outcome"], "manual_review")
        self.queue.pop()()
        self.execute.assert_not_called()

    def test_execution_lock_wait_is_rechecked_before_side_effect(self):
        lock = threading.Lock()
        self.executor = self.make_executor(execution_lock=lock)
        self.assertEqual(self.dispatch()[0], 202)
        with lock:
            thread = threading.Thread(target=self.queue.pop())
            thread.start()
            self.now += MAX_PENDING_MS
            self.assertEqual(self.dispatch()[1]["outcome"], "manual_review")
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.execute.assert_not_called()

    def test_close_retains_owner_until_callbacks_exit_and_prevents_new_work(self):
        self.assertEqual(self.dispatch()[0], 202)
        self.executor.close()
        self.assertEqual(self.dispatch()[0], 503)
        with self.assertRaises(ExecutorError):
            ExecutorLedger(self.path)
        self.queue.pop()()
        self.execute.assert_not_called()
        reopened = ExecutorLedger(self.path)
        reopened.close()

    def test_close_does_not_release_ownership_during_running_external_call(self):
        entered, release = threading.Event(), threading.Event()

        def execute(_reservation):
            entered.set()
            self.assertTrue(release.wait(5))
            return ExecutionResult("confirmed", True)

        self.executor._execute = execute
        self.assertEqual(self.dispatch()[0], 202)
        thread = threading.Thread(target=self.queue.pop())
        thread.start()
        self.assertTrue(entered.wait(5))
        try:
            self.executor.close()
            with self.assertRaises(ExecutorError):
                ExecutorLedger(self.path)
        finally:
            release.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.ledger = ExecutorLedger(self.path)
        self.executor = self.make_executor()
        self.assertEqual(self.dispatch()[1]["outcome"], "confirmed")

    def test_capacity_is_bounded_and_launch_failure_is_terminal(self):
        for index in range(16):
            self.assertEqual(self.dispatch(encode(delivery_id=f"synthetic-capacity-{index}"))[0], 202)
        self.assertEqual(self.dispatch()[0], 503)
        self.assertEqual(len(self.queue), 16)

    def test_launch_failure_never_retries_execution(self):
        self.executor._launch = Mock(side_effect=RuntimeError("PRIVATE"))
        self.assertEqual(self.dispatch()[1]["outcome"], "manual_review")
        self.assertEqual(self.dispatch()[1]["outcome"], "manual_review")
        self.assertEqual(self.executor._launch.call_count, 1)
        self.execute.assert_not_called()

    def test_terminal_row_and_delivery_identity_are_immutable(self):
        self.dispatch()
        self.queue.pop()()
        with sqlite3.connect(self.path) as db:
            for sql in ("UPDATE executor_deliveries SET status='running'", "UPDATE executor_deliveries SET fingerprint='other'"):
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)

    def test_disabled_by_default_and_enabled_configuration_fail_closed(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(configured_executor(cfg=None, debug_dir=Path(self.temp.name)))
        with patch.dict(os.environ, {"BOOKING_EXECUTOR_V1_ENABLED": "true"}, clear=True):
            with self.assertRaisesRegex(ExecutorError, "configuration_invalid"):
                configured_executor(cfg=None, debug_dir=Path(self.temp.name))


class PrivateEfBridgeTests(unittest.TestCase):
    def test_ef_result_only_marks_verified_after_actual_agenda_readback(self):
        from espacofacial.booking import BookingError, BookingRequest, execute_booking
        from espacofacial.private_operation import private_operation

        request = BookingRequest(unit_name="BarraShoppingSul", client_name="Paciente Sintetico",
                                 appointment_date="2026-09-10", start_time="12:00", end_time="12:30",
                                 service_name="Avaliação")
        driver = Mock(current_url="https://synthetic.invalid")
        with ExitStack() as stack:
            stack.enter_context(private_operation())
            for function in ("navigate_to_reception", "_ensure_agenda_tab", "_open_new_booking_sheet",
                             "_advance_until_review", "_finish_booking", "time.sleep"):
                stack.enter_context(patch("espacofacial.booking." + function, return_value=True))
            stack.enter_context(patch("espacofacial.booking._booking_dialog_still_open", return_value=False))
            verify = stack.enter_context(patch("espacofacial.booking._verify_booking_in_agenda", return_value=True))
            args = {"reception_url": "https://synthetic.invalid", "debug_dir": Path("unused")}
            self.assertTrue(execute_booking(driver, request=request, **args).verified_in_agenda)
            verify.assert_called_once()
            verify.reset_mock()
            self.assertFalse(execute_booking(driver, request=replace(request, dry_run=True), **args).verified_in_agenda)
            verify.assert_not_called()
            verify.return_value = False
            with self.assertRaises(BookingError):
                execute_booking(driver, request=request, **args)

    def test_existing_ef_mapping_and_verified_readback_required(self):
        cfg = SimpleNamespace(headless=True, chrome_user_data_dir=None, base_url="https://synthetic.invalid",
                              email="synthetic", password="synthetic", timeout_seconds=1,
                              reception_url="https://synthetic.invalid/reception")
        driver = Mock()
        with patch("espacofacial.core.create_driver", return_value=driver), \
             patch("espacofacial.auth.login_and_select_unit", return_value=True), \
             patch("espacofacial.booking.execute_booking") as execute:
            execute.return_value = SimpleNamespace(ok=True, verified_in_agenda=True)
            result = execute_existing_ef_booking(reservation(), cfg=cfg, debug_dir=Path("unused"))
            self.assertEqual(result, ExecutionResult("confirmed", True))
            request = execute.call_args.kwargs["request"]
            self.assertEqual(request.unit_name, "BarraShoppingSul")
            self.assertEqual(request.client_name, "Paciente Sintetico")
            self.assertEqual(request.professional_name, "Profissional Sintetico")
            self.assertEqual(request.service_name, "Avaliação")
            self.assertEqual(request.service_candidates, ("Avaliação Facial",))
            self.assertFalse(request.dry_run)
            driver.quit.assert_called_once()
            execute.return_value = SimpleNamespace(ok=True, verified_in_agenda=False)
            self.assertEqual(execute_existing_ef_booking(reservation(), cfg=cfg, debug_dir=Path("unused")),
                             ExecutionResult("confirmed", False))

    def test_private_context_suppresses_logs_and_artifacts_only_in_its_thread(self):
        from espacofacial import auth, diagnostics
        from espacofacial.private_operation import private_operation, private_operation_active

        driver = Mock()
        with tempfile.TemporaryDirectory() as temporary, patch("builtins.print") as printing:
            debug = Path(temporary) / "must-not-exist"
            with private_operation():
                self.assertTrue(private_operation_active())
                auth.log("PRIVATE synthetic")
                auth.log_file_only("PRIVATE synthetic")
                auth.log_exception("PRIVATE synthetic", RuntimeError("synthetic"))
                artifacts = diagnostics.capture_artifacts(driver, output_dir=debug, label="synthetic")
                self.assertIsNone(artifacts.screenshot_path)
                self.assertEqual(driver.mock_calls, [])
                self.assertFalse(debug.exists())
                other_thread = []
                thread = threading.Thread(target=lambda: other_thread.append(private_operation_active()))
                thread.start()
                thread.join()
                self.assertEqual(other_thread, [False])
            printing.assert_not_called()
            self.assertFalse(private_operation_active())
            auth.log("synthetic legacy unaffected")
            printing.assert_called_once()


class PrivateHttpTests(ExecutorFixture):
    def test_private_http_pending_terminal_headers_and_no_public_status(self):
        from espacofacial.booking_server import BookingHTTPServer, BookingJobStore, BookingRequestHandler

        worker = Mock()
        server = BookingHTTPServer(("127.0.0.1", 0), BookingRequestHandler,
                                   cfg=SimpleNamespace(unit_name="synthetic"), job_store=BookingJobStore(),
                                   worker=worker, booking_executor=self.executor)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(method, path, raw=b"", headers=None):
            connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
            try:
                connection.request(method, path, body=raw, headers=headers or {})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        try:
            with patch("espacofacial.booking_server.log") as log:
                raw = encode()
                headers = {**signed(raw), "content-type": "application/json"}
                self.assertEqual(request("POST", DISPATCH_PATH, raw, headers)[0], 202)
                self.assertEqual(request("POST", DISPATCH_PATH, raw, headers)[0], 409)
                self.assertEqual(request("POST", DISPATCH_PATH + "?secret=never", raw, headers)[0], 400)
                self.assertEqual(request("POST", DISPATCH_PATH, raw, {**headers, "transfer-encoding": "chunked"})[0], 400)
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                try:
                    connection.putrequest("POST", DISPATCH_PATH)
                    for key, value in headers.items():
                        connection.putheader(key, value)
                    connection.putheader(HEADER_PREFIX + "signature", "duplicate")
                    connection.putheader("Content-Length", str(len(raw)))
                    connection.endheaders(raw)
                    duplicate_response = connection.getresponse()
                    self.assertEqual(duplicate_response.status, 400)
                    duplicate_response.read()
                finally:
                    connection.close()
                log.assert_not_called()
                self.assertEqual(request("GET", DISPATCH_PATH)[0], 404)
                self.assertEqual(request("GET", "/api/agenda/book/synthetic-delivery-1")[0], 404)
                self.queue.pop()()
                headers.update(signed(raw, nonce="synthetic-http-next"))
                self.assertEqual(request("POST", DISPATCH_PATH, raw, headers)[1]["outcome"], "confirmed")
                server.booking_executor = None
                self.assertEqual(request("POST", DISPATCH_PATH, raw, headers)[0], 503)
                with patch.dict(os.environ, {"EF_BOOKING_API_TOKEN": "synthetic-legacy-token"}, clear=True):
                    self.assertEqual(request("POST", "/api/agenda/book", b"{}")[0], 401)
                    self.assertEqual(request("POST", "/api/agenda/book", b"{}", {"Authorization": "Bearer synthetic-legacy-token"})[0], 400)
                with patch.dict(os.environ, {}, clear=True):
                    self.assertEqual(request("POST", "/api/agenda/book", b"{}")[0], 400)
                worker.submit.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)


if __name__ == "__main__":
    unittest.main()
