const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Placeholder shown instead of dollar amounts while censor mode is on. The
// backend only serves rescaled values then, so this is cosmetic on top of
// server-side redaction, not the redaction itself.
export const MASK = "•••••";

export function money(v: number, cents = false): string {
  return (cents ? usdCents : usd).format(v);
}

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Axis-friendly short notation: $950K, $1.2M.
export function moneyCompact(v: number): string {
  return usdCompact.format(v);
}

export function signedMoney(v: number): string {
  return `${v >= 0 ? "+" : ""}${usd.format(v)}`;
}

export function pct(v: number): string {
  if (!isFinite(v)) return "–";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export function shortDate(ts: number, withTime = false): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

// Share of a whole as a percent string (vendored from the app's
// lib/format.ts). Ratios are scale-invariant, so this stays honest under
// censor mode: censored amounts arrive rescaled, and every share survives.
export function share(part: number, whole: number): string {
  if (!(whole > 0)) return "–";
  const s = (part / whole) * 100;
  if (!isFinite(s)) return "–";
  return `${Math.abs(s) < 10 ? s.toFixed(1) : String(Math.round(s))}%`;
}
