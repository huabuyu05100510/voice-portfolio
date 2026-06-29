"""
Token bucket rate limiter for server-side event throttling.

Provides:
- TokenBucket: single-key rate limiter with burst support and thread-safe refill.
- RateLimiter: per-key multi-bucket manager with TTL-based stale bucket cleanup.

Aligned with production-hardening plan tasks 13.7 (rate limiting) and
observability (Prometheus metric emission).
"""
import time
import threading
from typing import Optional


class TokenBucket:
    """Token bucket rate limiter.

    Tokens refill continuously at `rate` tokens/second, up to a maximum of
    `burst` tokens (bucket capacity).  Each `consume()` call deducts 1 token;
    if the bucket is empty, the call returns False (rate-limited).

    Thread-safe: all access is guarded by an internal lock.
    """

    def __init__(self, rate: float, burst: int):
        if rate <= 0:
            raise ValueError("rate must be > 0")
        if burst <= 0:
            raise ValueError("burst must be > 0")
        self.rate = rate          # tokens per second
        self.burst = burst        # max tokens (bucket capacity)
        self.tokens = float(burst)
        self.last = time.monotonic()
        self._lock = threading.Lock()

    def consume(self, n: int = 1) -> bool:
        """Try to consume `n` tokens.  Returns True if allowed."""
        if n <= 0:
            return True
        now = time.monotonic()
        with self._lock:
            # Refill tokens based on elapsed time
            elapsed = now - self.last
            self.tokens = min(float(self.burst), self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens >= n:
                self.tokens -= n
                return True
            return False

    @property
    def available(self) -> float:
        """Current token count (for debugging / metrics)."""
        with self._lock:
            return self.tokens


class RateLimiter:
    """Per-key rate limiter with TTL-based cleanup.

    Maintains a dict of key -> TokenBucket.  Buckets for keys that haven't
    been accessed in `ttl_seconds` are pruned on `cleanup()`.

    Usage::

        limiter = RateLimiter()

        if limiter.is_allowed(f'audio:{sid}', rate=100, burst=150):
            process()
        else:
            reject()

        # Periodic cleanup (call from a background thread or scheduler)
        limiter.cleanup(ttl_seconds=300)
    """

    def __init__(self):
        self._buckets: dict = {}
        self._lock = threading.Lock()

    def _get_bucket(self, key: str, rate: float, burst: int) -> TokenBucket:
        """Get or create a TokenBucket for `key`."""
        with self._lock:
            entry = self._buckets.get(key)
            if entry is None:
                bucket = TokenBucket(rate, burst)
                self._buckets[key] = (bucket, time.monotonic())
                return bucket
            bucket, _ = entry
            # Update last-access time
            self._buckets[key] = (bucket, time.monotonic())
            return bucket

    def is_allowed(self, key: str, rate: float, burst: int) -> bool:
        """Check whether `key` is allowed to proceed.

        Returns False when the per-key bucket has exhausted its tokens.
        """
        bucket = self._get_bucket(key, rate, burst)
        return bucket.consume()

    def cleanup(self, ttl_seconds: float = 300) -> int:
        """Remove buckets not accessed within `ttl_seconds`.  Returns count of stale keys removed."""
        now = time.monotonic()
        with self._lock:
            stale = [
                k for k, (_, last) in self._buckets.items()
                if now - last > ttl_seconds
            ]
            for k in stale:
                del self._buckets[k]
            return len(stale)

    @property
    def bucket_count(self) -> int:
        """Number of active buckets (for observability)."""
        with self._lock:
            return len(self._buckets)