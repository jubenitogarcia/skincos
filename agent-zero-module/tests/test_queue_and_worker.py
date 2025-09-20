import asyncio
import pytest
from az_queue import dedupe, queue


def test_dedupe():
    assert dedupe("a") is True
    assert dedupe("a") is False


@pytest.mark.asyncio
async def test_queue_put_get():
    await queue.put({"x": 1})
    v = await asyncio.wait_for(queue.get(), 1)
    assert v["x"] == 1
