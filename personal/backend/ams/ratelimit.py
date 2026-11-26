from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def _trim(self, key: str, now: float) -> deque[float]:
        events = self._events[key]
        while events and now - events[0] >= self.window:
            events.popleft()
        return events

    def _sweep(self, now: float) -> None:
        if now - self._last_sweep < self.window:
            return
        self._last_sweep = now
        for key in list(self._events):
            if not self._trim(key, now):
                del self._events[key]

    def retry_after(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            events = self._trim(key, now)
            if len(events) < self.limit:
                if not events:
                    self._events.pop(key, None)
                return 0
            return max(1, math.ceil(self.window - (now - events[0])))

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._trim(key, now).append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


class Limits:
    def __init__(self) -> None:
        self.login = RateLimiter(8, 5 * 60)
        self.recover = RateLimiter(5, 60 * 60)
