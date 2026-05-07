/** Generate a friendly 6-char invite code, e.g. "K7P2RA". */
export function generateInviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  const buf = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 6; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

/** YYYY-MM-DD for <input type="date"> friendliness. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Pretty-print a date+time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
