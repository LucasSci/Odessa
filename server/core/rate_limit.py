"""Rate limit em memória (por processo) para o backend FastAPI."""

from __future__ import annotations

import time
from collections import deque
from typing import Callable


class RateLimiter:
    """Janela deslizante em memória (por processo): no máximo `limit` chamadas em `window_s`."""

    def __init__(self, limit: int, window_s: float, clock: Callable[[], float] = time.monotonic):
        self._limit = limit
        self._window = window_s
        self._clock = clock
        self._hits: deque[float] = deque()

    def allow(self) -> bool:
        now = self._clock()
        while self._hits and now - self._hits[0] >= self._window:
            self._hits.popleft()
        if len(self._hits) >= self._limit:
            return False
        self._hits.append(now)
        return True

    def retry_after(self) -> int:
        """Segundos até liberar a próxima chamada (0 se já há vaga)."""
        if len(self._hits) < self._limit or not self._hits:
            return 0
        return max(1, int(self._window - (self._clock() - self._hits[0]) + 0.999))


class KeyedRateLimiter:
    """Um `RateLimiter` por chave (ex.: IP do cliente), com teto de chaves em memória."""

    def __init__(
        self,
        limit: int,
        window_s: float,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._limit = limit
        self._window = window_s
        self._max_keys = max_keys
        self._clock = clock
        self._limiters: dict[str, RateLimiter] = {}

    def allow(self, key: str) -> bool:
        limiter = self._limiters.get(key)
        if limiter is None:
            if len(self._limiters) >= self._max_keys:
                # Dicionário mantém ordem de inserção: descarta a chave mais antiga.
                self._limiters.pop(next(iter(self._limiters)))
            limiter = self._limiters[key] = RateLimiter(self._limit, self._window, self._clock)
        return limiter.allow()

    def retry_after(self, key: str) -> int:
        limiter = self._limiters.get(key)
        return limiter.retry_after() if limiter else 0
