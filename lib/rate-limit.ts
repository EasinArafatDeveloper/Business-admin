import "server-only";

/** Simple in-memory limiter for login attempts: 5 failures per 15 minutes per IP. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map<string, { count: number; resetAt: number }>();

export function isBlocked(ip: string) {
  const entry = fails.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    fails.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILS;
}

export function recordFailure(ip: string) {
  const now = Date.now();
  const entry = fails.get(ip);
  if (!entry || now > entry.resetAt) fails.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
}

export function clearFailures(ip: string) {
  fails.delete(ip);
}
