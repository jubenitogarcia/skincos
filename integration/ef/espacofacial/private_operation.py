"""Thread-local suppression for private executor calls, without changing legacy jobs."""

from contextlib import contextmanager
from contextvars import ContextVar

_private_operation = ContextVar("ef_private_operation", default=False)


def private_operation_active() -> bool:
    return _private_operation.get()


@contextmanager
def private_operation():
    token = _private_operation.set(True)
    try:
        yield
    finally:
        _private_operation.reset(token)
