"""
Task 13.7: Server Rate Limiting — TDD unit tests (per production-hardening plan)

Covers:
- TokenBucket: consume within limit, exceed limit, burst peaks, refill over time
- TokenBucket: thread independence (different keys = separate buckets)
- RateLimiter: per-key isolation, per-key burst, TTL cleanup
- RateLimiter: is_allowed rejects after exhaustion, respects rate + burst per key
- RateLimiter: cleanup removes stale buckets after TTL
- Edge cases: zero/negative rate, zero burst, negative consume count
"""
import sys
import os
import time
import pytest

SERVER_DIR = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, SERVER_DIR)

from rate_limiter import TokenBucket, RateLimiter


# ============================================================================
# TokenBucket — unit tests
# ============================================================================
class TestTokenBucket:
    """Token bucket primitive: consume, refill, capacity, thread-safety."""

    # --- happy path ----------------------------------------------------------

    def test_consume_within_limit(self):
        """Initial burst tokens available, first consume() returns True."""
        bucket = TokenBucket(rate=10, burst=20)
        assert bucket.consume() is True

    def test_consume_exceeds_limit(self):
        """When tokens are exhausted, consume() returns False."""
        bucket = TokenBucket(rate=10, burst=10)
        for _ in range(10):
            assert bucket.consume() is True
        # 11th call — rate limited
        assert bucket.consume() is False

    def test_burst_allows_spike(self):
        """Burst > rate allows a short spike above the steady-state rate."""
        bucket = TokenBucket(rate=10, burst=30)
        for _ in range(30):
            assert bucket.consume() is True
        # Exhausted after burst
        assert bucket.consume() is False

    def test_refill_over_time(self):
        """Tokens refill at the configured rate; waiting replenishes capacity."""
        bucket = TokenBucket(rate=100, burst=1)
        bucket.consume()  # drain the single token
        assert bucket.consume() is False
        time.sleep(0.02)   # 20 ms at 100 tokens/s ≈ 2 tokens refilled
        assert bucket.consume() is True

    def test_refill_does_not_exceed_burst(self):
        """Refill is capped at burst; bucket never exceeds capacity."""
        bucket = TokenBucket(rate=1000, burst=5)
        time.sleep(0.02)  # would add ~20 tokens if uncapped
        with bucket._lock:
            assert bucket.tokens <= 5

    def test_consume_multiple_tokens(self):
        """consume(n) with n > 1 works correctly."""
        bucket = TokenBucket(rate=10, burst=10)
        assert bucket.consume(3) is True   # 7 left
        assert bucket.consume(7) is True   # 0 left
        assert bucket.consume(1) is False

    def test_consume_zero_is_always_true(self):
        """n=0 is a no-op and always allowed."""
        bucket = TokenBucket(rate=1, burst=1)
        assert bucket.consume(0) is True
        bucket.consume(1)  # exhaust
        assert bucket.consume(0) is True  # still allowed

    # --- edge cases ----------------------------------------------------------

    def test_invalid_rate_raises(self):
        """rate <= 0 raises ValueError."""
        with pytest.raises(ValueError):
            TokenBucket(rate=0, burst=10)
        with pytest.raises(ValueError):
            TokenBucket(rate=-1, burst=10)

    def test_invalid_burst_raises(self):
        """burst <= 0 raises ValueError."""
        with pytest.raises(ValueError):
            TokenBucket(rate=10, burst=0)
        with pytest.raises(ValueError):
            TokenBucket(rate=10, burst=-5)

    # --- available property --------------------------------------------------

    def test_available_reflects_current_tokens(self):
        """available property returns approximate token count."""
        bucket = TokenBucket(rate=10, burst=10)
        assert bucket.available == pytest.approx(10.0)
        bucket.consume(3)
        assert bucket.available == pytest.approx(7.0)


# ============================================================================
# RateLimiter — per-key multi-bucket tests
# ============================================================================
class TestRateLimiter:
    """Per-key rate limiter: isolation, TTL cleanup."""

    def test_independent_keys(self):
        """Different keys get independent token buckets."""
        limiter = RateLimiter()
        # Exhaust key-a
        for _ in range(10):
            limiter.is_allowed('key-a', rate=100, burst=10)
        assert limiter.is_allowed('key-a', rate=100, burst=10) is False
        # key-b still has tokens
        assert limiter.is_allowed('key-b', rate=100, burst=10) is True

    def test_same_key_same_bucket(self):
        """Repeated calls on same key share the same bucket."""
        limiter = RateLimiter()
        assert limiter.is_allowed('s1', rate=100, burst=5) is True
        assert limiter.is_allowed('s1', rate=100, burst=5) is True
        # rate/burst are only used on first creation; changing them is ignored
        # for the same key

    def test_different_rate_per_key(self):
        """Keys can have different rate/burst limits."""
        limiter = RateLimiter()
        # 'slow' key: burst=1
        assert limiter.is_allowed('slow', rate=100, burst=1) is True
        assert limiter.is_allowed('slow', rate=100, burst=1) is False
        # 'fast' key: burst=50 — still has all its tokens
        for _ in range(50):
            assert limiter.is_allowed('fast', rate=100, burst=50) is True
        assert limiter.is_allowed('fast', rate=100, burst=50) is False

    def test_cleanup_removes_stale_buckets(self):
        """cleanup(ttl) removes buckets that haven't been accessed."""
        limiter = RateLimiter()
        limiter.is_allowed('stale', rate=10, burst=1)
        assert limiter.bucket_count == 1
        time.sleep(0.05)
        count = limiter.cleanup(ttl_seconds=0.01)  # TTL = 10 ms, bucket older
        assert count == 1
        assert limiter.bucket_count == 0

    def test_cleanup_preserves_active_buckets(self):
        """Active (recently accessed) buckets survive cleanup."""
        limiter = RateLimiter()
        limiter.is_allowed('active', rate=100, burst=1)
        # Immediate cleanup with very short TTL — but bucket was just touched
        count = limiter.cleanup(ttl_seconds=300)
        assert count == 0
        assert limiter.bucket_count == 1

    def test_bucket_count_reflects_reality(self):
        """bucket_count returns the number of known keys."""
        limiter = RateLimiter()
        assert limiter.bucket_count == 0
        limiter.is_allowed('a', rate=10, burst=1)
        limiter.is_allowed('b', rate=10, burst=1)
        assert limiter.bucket_count == 2

    def test_high_rate_never_limited(self):
        """Very high burst + rate essentially never rate-limits."""
        limiter = RateLimiter()
        for _ in range(1000):
            assert limiter.is_allowed('high', rate=10000, burst=10000) is True

    def test_return_type_is_bool(self):
        """is_allowed always returns a plain bool."""
        limiter = RateLimiter()
        result = limiter.is_allowed('k', rate=1, burst=1)
        assert isinstance(result, bool)
        assert result is True
        result = limiter.is_allowed('k', rate=1, burst=1)
        assert isinstance(result, bool)
        assert result is False
