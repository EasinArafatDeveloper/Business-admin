/** End of today in Dhaka (UTC+6), as a Date. */
export function endOfToday() {
  const local = new Date(Date.now() + 6 * 3600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - 6 * 3600_000);
}
