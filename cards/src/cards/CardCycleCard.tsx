import Ambient from "../components/Ambient";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Hass,
  fetchSeries,
  fetchSpendingTransactions,
} from "../lib/ha";
import { AccountSeries, SpendingTxn } from "../lib/types";
import {
  BaseCardConfig,
  LockControl,
  Overlay,
  ambientEffect,
  useNetwrthCore,
  useVisibleAccounts,
} from "./common";
import { MonthNav, amt, currentMonth } from "./spendingCommon";

// The credit-card cycle: per card, how the balance climbs with purchases
// and drops at payments across the selected month, with the month's
// spent/paid totals. Vendored from the app repo's
// frontend/components/spending/CardCycle.tsx — re-sync against it when the
// web graph changes.
//
// Debt is plotted as a positive magnitude (owing more = higher); payment
// markers sit where card-side payment credits posted. Balances come from
// the same snapshot series the net-worth chart uses, purchases/payments
// from the card's transactions — both already censor-scaled server-side,
// so this stays leak-free.

const W = 820;
const H = 200;
const PAD = { top: 26, right: 16, bottom: 24, left: 56 };

function monthWindow(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

export type CardCycleCardConfig = BaseCardConfig;

type Payload = { series: AccountSeries[]; txns: SpendingTxn[] };

export default function CardCycleCard({
  hass,
  config,
}: {
  hass: Hass;
  config: CardCycleCardConfig;
}) {
  const [month, setMonth] = useState(currentMonth());
  // Hover bubble: what the cursor's x-position means on that card's line —
  // replaces the static legend with the answer in place.
  const [hover, setHover] = useState<{
    left: number;
    top: number;
    title: string;
    rows: { label: string; value: string }[];
    note: string;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One card renders at a time; the chips are tabs. Many-card accounts
  // stay one chart tall instead of stacking a chart per card.
  const [selectedCard, setSelectedCard] = useState<number | null>(() => {
    const v = Number(localStorage.getItem("netwrth-cardcycle-card"));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const pickCard = (id: number) => {
    setSelectedCard(id);
    localStorage.setItem("netwrth-cardcycle-card", String(id));
  };

  const fetchData = useCallback(
    (h: Hass, e: string | undefined) =>
      Promise.all([fetchSeries(h, e, "6m"), fetchSpendingTransactions(h, e, month)]).then(
        ([se, tx]) => ({
          data: { series: se.series, txns: tx.transactions } as Payload,
          censored: tx.censored,
        })
      ),
    [month]
  );
  const { overview, data, masked, error, refresh } = useNetwrthCore<Payload>(
    hass,
    config.entry,
    fetchData
  );
  const visibleAccounts = useVisibleAccounts(overview);
  const cards = useMemo(
    () => visibleAccounts.filter((a) => a.kind === "credit"),
    [visibleAccounts]
  );
  const series = data?.series ?? [];
  const txns = data?.txns ?? [];
  const censored = masked;

  const { from, to } = monthWindow(month);

  const perCard = useMemo(() => {
    return cards.map((card) => {
      const points = (series.find((s) => s.account_id === card.id)?.points ?? [])
        .map((p) => ({ ts: new Date(p.ts), debt: Math.max(0, -parseFloat(p.balance)) }))
        .filter((p) => !isNaN(p.debt))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
      // Carry-in: last point before the window anchors the line's start.
      const before = points.filter((p) => p.ts < from);
      const inMonth = points.filter((p) => p.ts >= from && p.ts < to);
      const after = points.filter((p) => p.ts >= to);

      const cardTxns = txns
        .filter((t) => t.account_id === card.id && !t.pending)
        .map((t) => ({ ...t, v: parseFloat(t.amount), date: new Date(t.posted_at) }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      let spent = 0;
      let paid = 0;
      const payments: { date: Date; amount: number }[] = [];
      for (const t of cardTxns) {
        if (t.v > 0) {
          spent += t.v;
        } else if (t.theme === "debt" || t.theme === "transfers") {
          // Card-side payment credit (matched or PFC-labeled).
          paid += -t.v;
          payments.push({ date: t.date, amount: -t.v });
        }
      }

      const line = [...(before.length ? [{ ...before[before.length - 1], ts: from }] : []), ...inMonth];

      // Snapshots start at connection time, but transactions reach further
      // back — so the balance before the first snapshot is reconstructable:
      // walk backward from the first known balance, undoing each purchase
      // (+debt) and payment (−debt). Rendered dashed: derived, not observed.
      let recon: { ts: Date; debt: number }[] = [];
      if (before.length === 0 && (inMonth.length > 0 || after.length > 0)) {
        const anchorTs = inMonth.length > 0 ? inMonth[0].ts : to;
        const anchorDebt = inMonth.length > 0 ? inMonth[0].debt : after[0].debt;
        let running = anchorDebt;
        const back: { ts: Date; debt: number }[] = [];
        for (const t of [...cardTxns].reverse()) {
          if (t.date >= anchorTs || t.date < from) continue;
          running = Math.max(0, running - t.v);
          back.unshift({ ts: t.date, debt: running });
        }
        recon = [{ ts: from, debt: back.length ? back[0].debt : running }, ...back];
        if (inMonth.length > 0) recon.push({ ts: anchorTs, debt: anchorDebt });
      }

      return { card, line, recon, spent, paid, payments };
    });
  }, [cards, series, txns, from, to]);

  const withData = perCard.filter(
    (c) => c.line.length > 0 || c.recon.length > 0 || c.spent > 0 || c.paid > 0
  );
  const active = withData.find((c) => c.card.id === selectedCard) ?? withData[0];
  const visible = active ? [active] : [];

  const daysInMonth = Math.round((to.getTime() - from.getTime()) / 86400000);
  const x = (d: Date) =>
    PAD.left +
    (Math.min(Math.max((d.getTime() - from.getTime()) / 86400000, 0), daysInMonth) / daysInMonth) *
      (W - PAD.left - PAD.right);

  // Step-function readout: the balance that held at time t.
  const valueAt = (pts: { ts: Date; debt: number }[], t: number): number | null => {
    let v: number | null = null;
    for (const p of pts) {
      if (p.ts.getTime() <= t) v = p.debt;
      else break;
    }
    return v;
  };

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? "Card credit"}</h2>
        <span className="head-right">
          <MonthNav month={month} onChange={setMonth} />
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
      {!error && !data && <div className="status">Loading…</div>}
      {!error && data && withData.length === 0 && (
        <div className="status">No credit-card activity this month.</div>
      )}
      {!error && data && withData.length > 1 && (
        <div className="spend-card-chips">
          {withData.map(({ card }) => (
            <button
              key={card.id}
              className={`spend-card-chip ${active && card.id === active.card.id ? "on" : ""}`}
              title="Show this card"
              onClick={() => pickCard(card.id)}
            >
              {card.nickname ?? card.name}
            </button>
          ))}
        </div>
      )}
      <div className="body-fill">
      {!error &&
        data &&
        visible.map(({ card, line, recon, spent, paid, payments }) => {
          const maxDebt = Math.max(
            1,
            ...line.map((p) => p.debt),
            ...recon.map((p) => p.debt),
            ...payments.map((p) => p.amount)
          );
          const y = (v: number) => H - PAD.bottom - (v / maxDebt) * (H - PAD.top - PAD.bottom);
          const now = new Date();
          const todayX = now >= from && now < to ? x(now) : null;
          // A finished month's balance holds to the right edge; the current
          // month's observation stops at today — no line for days that
          // haven't happened yet.
          const edgeX = todayX ?? W - PAD.right;
          // Step paths: balance holds until the next point.
          const stepPath = (pts: { ts: Date; debt: number }[], extendToEdge: boolean) => {
            let p = "";
            pts.forEach((pt, i) => {
              p += i === 0 ? `M${x(pt.ts)},${y(pt.debt)}` : `H${x(pt.ts)}V${y(pt.debt)}`;
            });
            if (p && extendToEdge) p += `H${edgeX}`;
            return p;
          };
          const reconPath = stepPath(recon, line.length === 0);
          const path = stepPath(line, true);
          // Soft area under the whole line (estimated + observed): this is
          // a balance, not a warning.
          const all = [...recon, ...line].sort((a, b) => a.ts.getTime() - b.ts.getTime());
          const areaPath = all.length
            ? `${stepPath(all, true)} V${H - PAD.bottom} H${x(all[0].ts)} Z`
            : "";
          const name = card.nickname ?? card.name;
          return (
            <div key={card.id} className="spend-card-row">
              <div className="spend-card-head">
                <span>{name}</span>
                <span className="muted">
                  spent {amt(spent, censored)} · paid {amt(paid, censored)}
                  {(line.length > 0 || recon.length > 0) &&
                    ` · owing ${amt((line[line.length - 1] ?? recon[recon.length - 1]).debt, censored)}`}
                </span>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="spend-cal-svg" role="img"
                aria-label={`${name} balance through the month`}
                onMouseLeave={() => {
                  if (hideTimer.current) clearTimeout(hideTimer.current);
                  hideTimer.current = setTimeout(() => setHover(null), 80);
                }}
                onMouseMove={(e) => {
                  if (hideTimer.current) clearTimeout(hideTimer.current);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const scale = rect.width / W;
                  const cx = (e.clientX - rect.left) / scale;
                  const cy = (e.clientY - rect.top) / scale;
                  if (cx < PAD.left || cx > W - PAD.right) {
                    setHover(null);
                    return;
                  }
                  const t =
                    from.getTime() +
                    ((cx - PAD.left) / (W - PAD.left - PAD.right)) * daysInMonth * 86400000;
                  // Nothing to read out past today: the line stops there.
                  if (todayX !== null && t > now.getTime()) {
                    setHover(null);
                    return;
                  }
                  const day = new Date(t).getUTCDate();
                  const yOf = y;
                  // A payment marker under the cursor wins over the line.
                  const pay = payments.find(
                    (p) => Math.abs(x(p.date) - cx) < 12 && Math.abs(yOf(p.amount) - cy) < 14
                  );
                  let rows: { label: string; value: string }[];
                  let note: string;
                  if (pay) {
                    rows = [
                      { label: "day", value: String(pay.date.getUTCDate()) },
                      { label: "payment", value: `-${amt(pay.amount, censored)}` },
                    ];
                    note = "a payment landed on the card";
                  } else {
                    const observed = line.length > 0 && t >= line[0].ts.getTime();
                    const v = observed ? valueAt(line, t) : valueAt(recon, t);
                    if (v === null) {
                      setHover(null);
                      return;
                    }
                    rows = [
                      { label: "day", value: String(day) },
                      { label: "owing", value: amt(v, censored) },
                    ];
                    note = observed
                      ? "balance reported by the card"
                      : "estimated from transactions — before the first report we have";
                  }
                  setHover({ left: e.clientX + 14, top: e.clientY - 12, title: name, rows, note });
                }}>
                <defs>
                  <linearGradient id={`ccfill-${card.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="var(--nb-ink)" stopOpacity="0.26" />
                    <stop offset="1" stopColor="var(--nb-ink)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[1, 8, 15, 22, 29].map((d) => {
                  const gx = x(new Date(from.getTime() + (d - 1) * 86400000));
                  return (
                    <g key={d}>
                      <line x1={gx} y1={PAD.top} x2={gx} y2={H - PAD.bottom}
                        stroke="var(--nb-border)" strokeWidth="1" opacity="0.45" />
                      <text x={gx} y={H - 6} textAnchor="middle" fill="var(--nb-muted)" fontSize="11">
                        {d}
                      </text>
                    </g>
                  );
                })}
                <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
                  stroke="var(--nb-border)" strokeWidth="1" />
                {!censored && (
                  <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" fill="var(--nb-muted)" fontSize="11">
                    {amt(maxDebt, censored)}
                  </text>
                )}
                {areaPath && <path d={areaPath} fill={`url(#ccfill-${card.id})`} />}
                {reconPath && (
                  <path d={reconPath} fill="none" stroke="var(--nb-ink)" strokeWidth="2"
                    strokeLinejoin="round" opacity="0.45" />
                )}
                {path && (
                  <path d={path} fill="none" stroke="var(--nb-ink)" strokeWidth="2"
                    strokeLinejoin="round" opacity="0.95" />
                )}
                {todayX !== null && (
                  <g>
                    <line x1={todayX} y1={PAD.top - 6} x2={todayX} y2={H - PAD.bottom}
                      stroke="var(--nb-accent)" strokeWidth="1.5" opacity="0.8" />
                    <text x={todayX} y={PAD.top - 10} textAnchor="middle"
                      fill="var(--nb-accent)" fontSize="11">today</text>
                  </g>
                )}
                {payments.map((p, i) => (
                  <g key={i}>
                    <line x1={x(p.date)} y1={y(p.amount)} x2={x(p.date)} y2={H - PAD.bottom}
                      stroke="var(--nb-green)" strokeWidth="2" opacity="0.55" />
                    <circle cx={x(p.date)} cy={y(p.amount)} r={4.5} fill="var(--nb-bg)"
                      stroke="var(--nb-green)" strokeWidth="2" />
                    {!censored && (
                      <text x={x(p.date)} y={y(p.amount) - 10} textAnchor="middle"
                        fill="var(--nb-green)" fontSize="11">
                        -{amt(p.amount, censored)}
                      </text>
                    )}
                    <title>{`payment ${p.date.toISOString().slice(0, 10)}${censored ? "" : `: ${amt(p.amount, censored)}`}`}</title>
                  </g>
                ))}
              </svg>
            </div>
          );
        })}
      </div>
      {hover && (
        <Overlay>
        <div
          className="spend-hoverbubble"
          style={{
            left: Math.min(hover.left, window.innerWidth - 240),
            top: hover.top,
          }}
        >
          <div className="spend-bubble-title">{hover.title}</div>
          <div className="spend-bubble-rows">
            {hover.rows.map((r) => (
              <div key={r.label} className="spend-bubble-row">
                <span className="muted">{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
          </div>
          <div className="muted spend-hoverbubble-note">{hover.note}</div>
        </div>
        </Overlay>
      )}
    </div>
  );
}
