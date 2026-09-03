/**
 * Login throttling: a sliding window of failed attempts per account and per
 * client address, so a password cannot be guessed online.
 *
 *   per email : 10 failures in 15 minutes → locked for the rest of the window
 *   per IP    : 50 failures in 15 minutes → same (one address hammering many
 *               accounts)
 *
 * A successful login clears the account's counter (the IP counter keeps
 * counting: a success on one account says nothing about the others). The
 * account lock answers 429 with `Retry-After`, and the same message whether
 * the email exists or not, so the throttle leaks nothing the 401 does not.
 *
 * State lives in process memory. That is right for the single API container
 * the deploy runs (deploy/docker-compose.prod.yml); a multi-instance deploy
 * would need this behind a shared store, and a restart clears the counters —
 * an attacker cannot trigger one, so that only ever helps a locked-out user.
 * Bounded: stale keys are swept on every check.
 */

export interface ThrottlePolicy {
  windowMs: number;
  maxPerEmail: number;
  maxPerIp: number;
}

export const DEFAULT_LOGIN_THROTTLE: ThrottlePolicy = {
  windowMs: 15 * 60 * 1000,
  maxPerEmail: 10,
  maxPerIp: 50,
};

export interface ThrottleVerdict {
  allowed: boolean;
  /** Seconds until the caller may try again (0 when allowed). */
  retryAfterSeconds: number;
}

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly policy: ThrottlePolicy = DEFAULT_LOGIN_THROTTLE) {}

  /** Is a login attempt for `email` from `ip` allowed right now? */
  check(email: string, ip: string, now = Date.now()): ThrottleVerdict {
    this.sweep(now);
    const byEmail = this.recent(`e:${normalizeEmail(email)}`, now);
    const byIp = this.recent(`ip:${ip}`, now);
    const blocked =
      (byEmail.length >= this.policy.maxPerEmail ? byEmail : null) ??
      (byIp.length >= this.policy.maxPerIp ? byIp : null);
    if (!blocked) return { allowed: true, retryAfterSeconds: 0 };
    const oldest = blocked[0];
    const retryAfterMs = Math.max(0, oldest + this.policy.windowMs - now);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  /** Record a failed attempt (wrong password, unknown account, inactive account). */
  recordFailure(email: string, ip: string, now = Date.now()): void {
    for (const key of [`e:${normalizeEmail(email)}`, `ip:${ip}`]) {
      const list = this.recent(key, now);
      list.push(now);
      this.failures.set(key, list);
    }
  }

  /** A correct password clears the account's counter. */
  recordSuccess(email: string): void {
    this.failures.delete(`e:${normalizeEmail(email)}`);
  }

  /** For tests. */
  reset(): void {
    this.failures.clear();
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.policy.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    return list;
  }

  private sweep(now: number): void {
    const cutoff = now - this.policy.windowMs;
    for (const [key, list] of this.failures) {
      if (list.length === 0 || list[list.length - 1] <= cutoff) this.failures.delete(key);
    }
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The client address as seen through the reverse proxy (deploy/Caddyfile sets
 * X-Forwarded-For); "unknown" when there is none, so direct calls still share
 * one per-IP bucket rather than escaping the limit.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** The process-wide throttle the login route uses. */
export const loginThrottle = new LoginThrottle();
