import Ambient from "../components/Ambient";
import { useCallback, useState } from "react";
import { MASK, money } from "../lib/format";
import {
  Hass,
  SpendingRecurring,
  fetchSpendingRecurring,
  fetchSpendingSummary,
  fetchSpendingTransactions,
} from "../lib/ha";
import { SpendingSummary, SpendingTxn } from "../lib/types";
import { BaseCardConfig, LockControl, ambientEffect, useNetwrthCore } from "./common";
import {
  MonthNav,
  NON_SPEND,
  PER_MONTH,
  amt,
  currentMonth,
  themeColor,
} from "./spendingCommon";

// Counterpart of the web dashboard's spending tab summary: the month's
// Spent / Income / Recurring stat tiles, the share-of-spending donut, and
// the "where it went" theme bars with a read-only transaction drill-down.
// Vendored from frontend/components/spending/SpendingPanel.tsx in the app
// repo — re-sync against it when the web graphs change.

export type SpendingCardConfig = BaseCardConfig & {
  show_stats?: boolean;
  show_donut?: boolean;
};

type Payload = { summary: SpendingSummary; recurring: SpendingRecurring };

// Small round merchant mark: logo when we have one, colored initial when
// we don't.
function MerchantDot({ tx }: { tx: SpendingTxn }) {
  const [broken, setBroken] = useState(false);
  const label = tx.merchant ?? tx.merchant_key;
  if (tx.logo_url && !broken) {
    return (
      <img
        className="spend-txn-logo"
        src={tx.logo_url}
        alt=""
        onError={() => setBroken(true)}
      />
    );
  }
  // Neutral chip with a thin theme-colored ring: no invented hues, and
  // the ring's meaning comes from the one system that already has color.
  return (
    <span
      className="spend-txn-logo spend-txn-initial"
      style={{ borderColor: themeColor(tx.theme ?? "other") }}
    >
      {(label.charAt(0) || "?").toUpperCase()}
    </span>
  );
}

// Part-to-whole donut beside the theme bars: at-a-glance shares only (the
// bars carry the exact comparisons). Top slices + a gray fold keep it ≤ 6
// segments.
function SpendDonut({
  rows,
  totalSpend,
  censored,
}: {
  rows: { theme: string; total: string }[];
  totalSpend: number;
  censored: boolean;
}) {
  const total = rows.reduce((a, r) => a + parseFloat(r.total), 0);
  if (total <= 0) return null;
  const MAX_SLICES = 5;
  const slices: { theme: string; value: number; color: string }[] = rows
    .slice(0, MAX_SLICES)
    .map((r) => ({ theme: r.theme, value: parseFloat(r.total), color: themeColor(r.theme) }));
  const rest = rows.slice(MAX_SLICES).reduce((a, r) => a + parseFloat(r.total), 0);
  if (rest > 0) slices.push({ theme: "everything else", value: rest, color: "#8b9bb4" });

  const R = 80;
  const r = 50;
  const C = 90;
  let angle = -Math.PI / 2; // start at 12 o'clock
  const arcs = slices.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
    const d = `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    const mid = (a0 + a1) / 2;
    return { ...s, d, mid, share: s.value / total };
  });

  return (
    <svg viewBox="0 0 180 180" className="spend-donut" role="img" aria-label="Share of spending by theme">
      {arcs.map((a) => (
        <path key={a.theme} d={a.d} fill={a.color} fillOpacity={0.85}
          stroke="var(--nb-bg)" strokeWidth="2">
          <title>{`${a.theme} — ${Math.round(a.share * 100)}%${censored ? "" : ` (${amt(a.value, censored)})`}`}</title>
        </path>
      ))}
      {arcs
        .filter((a) => a.share >= 0.08)
        .map((a) => (
          <text
            key={`l-${a.theme}`}
            x={C + ((R + r) / 2) * Math.cos(a.mid)}
            y={C + ((R + r) / 2) * Math.sin(a.mid) + 4}
            textAnchor="middle"
            fill="#0b0f17"
            fontSize="11"
            fontWeight="600"
            pointerEvents="none"
          >
            {Math.round(a.share * 100)}%
          </text>
        ))}
      <text x={C} y={C - 2} textAnchor="middle" fill="var(--nb-text)" fontSize="15" fontWeight="600">
        {censored ? MASK : money(totalSpend)}
      </text>
      <text x={C} y={C + 14} textAnchor="middle" fill="var(--nb-muted)" fontSize="10">
        spent
      </text>
    </svg>
  );
}

export default function SpendingCard({
  hass,
  config,
}: {
  hass: Hass;
  config: SpendingCardConfig;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [openTheme, setOpenTheme] = useState<string | null>(null);
  const [txns, setTxns] = useState<SpendingTxn[] | null>(null);

  const fetchData = useCallback(
    (h: Hass, e: string | undefined) =>
      Promise.all([fetchSpendingSummary(h, e, month), fetchSpendingRecurring(h, e, month)]).then(
        ([summary, recurring]) => ({ data: { summary, recurring } as Payload, censored: summary.censored })
      ),
    [month]
  );
  const { overview, data, masked, error, refresh } = useNetwrthCore<Payload>(
    hass,
    config.entry,
    fetchData
  );

  const setMonthAndClose = (m: string) => {
    setMonth(m);
    setOpenTheme(null);
    setTxns(null);
  };

  const toggleTheme = (theme: string) => {
    if (openTheme === theme) {
      setOpenTheme(null);
      setTxns(null);
      return;
    }
    setOpenTheme(theme);
    setTxns(null);
    fetchSpendingTransactions(hass, config.entry, month, theme)
      .then((out) => setTxns(out.transactions))
      .catch(() => setTxns([]));
  };

  const summary = data?.summary ?? null;
  const recurring = data?.recurring ?? null;

  const spendRows = summary
    ? summary.themes.filter((t) => !NON_SPEND.has(t.theme) && parseFloat(t.total) > 0)
    : [];
  const maxTotal = Math.max(1e-9, ...spendRows.map((t) => parseFloat(t.total)));
  const bills = recurring ? recurring.streams.filter((s) => !s.is_income) : [];
  const activeBills = bills.filter((s) => s.active);
  const recurringMonthly = activeBills.reduce(
    (acc, s) => acc + parseFloat(s.average_amount) * (PER_MONTH[s.frequency] ?? 1),
    0
  );
  // "On track for": what already left this month plus the bills still
  // predicted to come. Only meaningful while looking at the live month.
  const expectedBillsRemaining = recurring
    ? recurring.expected
        .filter((e) => !e.is_income && !e.overdue)
        .reduce((acc, e) => acc + e.amount, 0)
    : 0;
  const projectedSpend =
    summary && month === currentMonth() && expectedBillsRemaining > 0
      ? parseFloat(summary.total_spend) + expectedBillsRemaining
      : null;

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? "Spending"}</h2>
        <span className="head-right">
          <MonthNav month={month} onChange={setMonthAndClose} />
          {overview && (
            <LockControl
              hass={hass}
              entry={config.entry}
              overview={overview}
              autoConcealMinutes={config.auto_conceal_minutes}
              onChanged={refresh}
            />
          )}
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}
      {!error && !summary && <div className="status">Loading…</div>}
      {!error && summary && (
        <div className="body-scroll">
          {config.show_stats !== false && (
            <div className="spend-stats">
              <div className="spend-stat">
                <span className="spend-stat-label">Spent</span>
                <span className="spend-stat-value">
                  {masked ? MASK : money(parseFloat(summary.total_spend))}
                </span>
                {projectedSpend !== null && !masked && (
                  <span className="muted">on track ~{money(projectedSpend)}</span>
                )}
              </div>
              <div className="spend-stat">
                <span className="spend-stat-label">Income</span>
                <span className="spend-stat-value up">
                  {masked ? MASK : money(parseFloat(summary.total_income))}
                </span>
              </div>
              <div className="spend-stat">
                <span className="spend-stat-label">Recurring bills</span>
                <span className="spend-stat-value">
                  {masked ? MASK : `${money(recurringMonthly)}/mo`}
                </span>
                <span className="muted">{activeBills.length} active</span>
              </div>
            </div>
          )}

          {spendRows.length === 0 && <div className="status">No spending recorded this month.</div>}
          {spendRows.length > 0 && (
            <div className="spend-themes-split">
              {config.show_donut !== false && (
                <SpendDonut
                  rows={spendRows}
                  totalSpend={parseFloat(summary.total_spend)}
                  censored={masked}
                />
              )}
              <div className="spend-themes-bars">
                {spendRows.map((t) => (
                  <div key={t.theme}>
                    <button
                      className={`spend-row ${openTheme === t.theme ? "open" : ""}`}
                      onClick={() => toggleTheme(t.theme)}
                    >
                      <span className="spend-row-label">
                        <span
                          className="spend-theme-dot"
                          style={{ background: themeColor(t.theme) }}
                        />
                        {t.theme}
                      </span>
                      <span className="spend-row-bar">
                        <span
                          className="spend-row-fill"
                          style={{
                            width: `${(parseFloat(t.total) / maxTotal) * 100}%`,
                            ["--bar-color" as string]: themeColor(t.theme),
                          }}
                        />
                      </span>
                      <span className="spend-row-amount">{amt(parseFloat(t.total), masked)}</span>
                      <span className="muted spend-row-count">{t.count}×</span>
                    </button>
                    {openTheme === t.theme && (
                      <div className="spend-txns">
                        {txns === null && <div className="muted">Loading…</div>}
                        {txns !== null &&
                          [...txns]
                            .sort(
                              (a, b) =>
                                Number(b.pending) - Number(a.pending) ||
                                b.posted_at.localeCompare(a.posted_at)
                            )
                            .map((tx) => (
                              <div key={tx.id} className="spend-txn">
                                <span className="muted spend-txn-date">
                                  {new Date(tx.posted_at).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    timeZone: "UTC",
                                  })}
                                </span>
                                <MerchantDot tx={tx} />
                                <span className="spend-txn-desc" title={tx.description}>
                                  {tx.merchant ?? tx.description}
                                  {tx.pending ? " · pending" : ""}
                                </span>
                                <span className="spend-txn-amount">
                                  {amt(parseFloat(tx.amount), masked)}
                                </span>
                              </div>
                            ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
