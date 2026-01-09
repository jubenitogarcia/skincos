import asyncio
from collections import deque

class InMemoryQueue:
    def __init__(self):
        self.q = deque()
        self.cv = asyncio.Condition()

    async def put(self, item):
        async with self.cv:
            self.q.append(item)
            self.cv.notify()

    async def get(self):
        async with self.cv:
            while not self.q:
                await self.cv.wait()
            return self.q.popleft()

queue = InMemoryQueue()
processed_events = set()

def dedupe(event_id: str) -> bool:
    if event_id in processed_events:
        return False
    processed_events.add(event_id)
    # naive size control
    if len(processed_events) > 5000:
        for _ in range(len(processed_events)//2):
            try:
                processed_events.pop()
            except KeyError:
                break
    return True
