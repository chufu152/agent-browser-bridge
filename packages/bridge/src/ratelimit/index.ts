// 速率限制 — 按会话令牌桶限流，防止单 Agent 阻塞其他 Agent。
// 默认：每会话每秒 50 个请求，桶容量 100。达到限制返回 RATE_LIMITED。

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private readonly capacity = 100,
    private readonly refillPerSecond = 50
  ) {}

  check(sessionId: string): RateLimitResult {
    const now = Date.now();
    let b = this.buckets.get(sessionId);
    if (!b) {
      b = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(sessionId, b);
    }
    const elapsed = (now - b.lastRefill) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.lastRefill = now;

    if (b.tokens < 1) {
      const retryAfterMs = Math.ceil((1 - b.tokens) / this.refillPerSecond * 1000);
      return { allowed: false, retryAfterMs };
    }
    b.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}
