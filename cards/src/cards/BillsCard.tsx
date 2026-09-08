import Ambient from "../components/Ambient";
import { useCallback, useMemo, useState } from "react";
import {
  Hass,
  SpendingRecurring,
  fetchSpendingRecurring,
} from "../lib/ha";
import { RecurringStream } from "../lib/types";
import { BaseCardConfig, LockControl, ambientEffect, useNetwrthCore } from "./common";
import { MonthNav, amt, currentMonth, themeColor } from "./spendingCommon";

// The recurring-bills calendar: day of month across, cost up. Vendored from
// frontend/components/spending/SubscriptionCalendar.tsx in the app repo
// (read-only: hover/titles instead of the web inspector) — re-sync against
// it when the web graph changes.
//
// Bills (monthly and slower) are lollipops — solid where the charge
// already happened (actual day and amount), dashed/translucent where it's
// still expected, dimmer when it was expected before today but never
// arrived. Income (payroll, any cadence) renders as flat pills along the
// top edge: what matters about income here is *when* it lands relative to
// the bills, not its height. A vertical line marks today.
//
// Sub-monthly bills (weekly cleaners) and lapsed streams live in the chip
// strip below; predictions come from the backend (interval-anchored) and
// this card only renders {date, amount, state}.
//
// Cost uses a log scale: a mortgage and a $3 sub differ by three orders of
// magnitude, and even sqrt flattens everything under the biggest bill.

const W = 820;
const H = 310;
// top reserves the income-pill lane; stems never reach it.
const PAD = { top: 88, right: 16, bottom: 28, left: 16 };
const PILL_Y = 24;
const ICON = 26;

const FREQ_TAG: Record<string, string> = { quarterly: "/qtr", annual: "/yr" };
const CHART_FREQS = new Set(["monthly", "quarterly", "annual"]);

type MarkState = "actual" | "expected" | "overdue";

type Mark = {
  id: string;
  merchantKey: string;
  name: string;
  logo: string | null;
  day: number;
  amount: number;
  state: MarkState;
  frequency: string;
  theme: string | null;
};

const STATE_LABEL: Record<MarkState, string> = {
  actual: "charged",
  expected: "expected around this day",
  overdue: "expected but not seen yet",
};

function dayOf(iso: string): number {
  return new Date(iso).getUTCDate();
}

export type BillsCardConfig = BaseCardConfig;

export default function BillsCard({
  hass,
  config,
}: {
  hass: Hass;
  config: BillsCardConfig;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [hover, setHover] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const fetchData = useCallback(
    (h: Hass, e: string | undefined) =>
      fetchSpendingRecurring(h, e, month).then((rec) => ({ data: rec, censored: rec.censored })),
    [month]
  );
  const { overview, data, masked, error, refresh } = useNetwrthCore<SpendingRecurring>(
    hass,
    config.entry,
    fetchData
  );

  const streams = data?.streams ?? [];
  const expected = data?.expected ?? [];
  const actuals = data?.actuals ?? [];
  const today = data?.today ?? "";
  const censored = masked;

  const streamByKey = useMemo(() => {
    const m = new Map<string, RecurringStream>();
    for (const s of streams) m.set(`${s.merchant_key}|${s.is_income}`, s);
    return m;
  }, [streams]);

  // Bill marks: this month's actual charges plus what's still projected,
  // for monthly-and-slower streams.
  const marks = useMemo(() => {
    const out: Mark[] = [];
    for (const a of actuals) {
      const s = streamByKey.get(`${a.merchant_key}|false`);
      if (a.is_income || !s || !CHART_FREQS.has(s.frequency)) continue;
      out.push({
        id: `a-${a.merchant_key}-${a.date}`,
        merchantKey: a.merchant_key,
        name: s.merchant ?? a.merchant_key,
        logo: s.logo_url,
        day: dayOf(a.date),
        amount: parseFloat(a.amount),
        state: "actual",
        frequency: s.frequency,
        theme: s.theme,
      });
    }
    for (const e of expected) {
      if (e.is_income || !CHART_FREQS.has(e.frequency)) continue;
      out.push({
        id: `e-${e.merchant_key}-${e.date}`,
        merchantKey: e.merchant_key,
        name: e.merchant || e.merchant_key,
        logo: e.logo_url ?? null,
        day: dayOf(e.date),
        amount: e.amount,
        state: e.overdue ? "overdue" : "expected",
        frequency: e.frequency,
        theme: streamByKey.get(`${e.merchant_key}|false`)?.theme ?? null,
      });
    }
    return out;
  }, [actuals, expected, streamByKey]);

  // Income pills: every paycheck-like event this month, real or projected.
  const pills = useMemo(() => {
    const out: Mark[] = [];
    for (const a of actuals) {
      if (!a.is_income) continue;
      const s = streamByKey.get(`${a.merchant_key}|true`);
      out.push({
        id: `ia-${a.merchant_key}-${a.date}`,
        merchantKey: a.merchant_key,
        name: s?.merchant ?? a.merchant_key,
        logo: null,
        day: dayOf(a.date),
        amount: parseFloat(a.amount),
        state: "actual",
        frequency: s?.frequency ?? "monthly",
        theme: null,
      });
    }
    for (const e of expected) {
      if (!e.is_income) continue;
      out.push({
        id: `ie-${e.merchant_key}-${e.date}`,
        merchantKey: e.merchant_key,
        name: e.merchant || e.merchant_key,
        logo: null,
        day: dayOf(e.date),
        amount: e.amount,
        state: e.overdue ? "overdue" : "expected",
        frequency: e.frequency,
        theme: null,
      });
    }
    return out.sort((a, b) => a.day - b.day);
  }, [actuals, expected, streamByKey]);

  // Strip: sub-monthly bills the chart can't place, plus lapsed
  // *subscriptions* — "looks cancelled" is real signal for Netflix, but a
  // restaurant streak that petered out is just noise.
  const strip = useMemo(
    () =>
      streams.filter(
        (s) =>
          !s.is_income &&
          ((s.active && !CHART_FREQS.has(s.frequency)) ||
            (!s.active && s.theme === "subscriptions"))
      ),
    [streams]
  );

  const todayDay = today ? dayOf(today) : 0;
  const amounts = marks.map((m) => m.amount).filter((v) => v > 0);
  const maxAmt = Math.max(1e-9, ...amounts);
  const minAmt = Math.min(maxAmt, ...amounts);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + ((day - 1) / 30) * innerW;
  // Height maps log(amount) onto [15%, 100%] of the plot between the
  // smallest and largest mark. Working in log-ratios keeps the shape
  // identical under censor mode's uniform rescaling.
  const logSpan = Math.log(maxAmt) - Math.log(minAmt);
  const y = (v: number) => {
    const t = logSpan < 1e-6 ? 0.6 : (Math.log(Math.max(v, minAmt)) - Math.log(minAmt)) / logSpan;
    return H - PAD.bottom - (0.15 + 0.85 * t) * innerH;
  };

  // Same-day marks dodge horizontally so their icons don't stack.
  const offsets = useMemo(() => {
    const byDay = new Map<number, Mark[]>();
    for (const m of marks) byDay.set(m.day, [...(byDay.get(m.day) ?? []), m]);
    const out = new Map<string, number>();
    for (const group of byDay.values()) {
      group.forEach((m, i) => out.set(m.id, (i - (group.length - 1) / 2) * (ICON + 6)));
    }
    return out;
  }, [marks]);

  // State reads as shape + one attention color: charged = filled chip on
  // a solid stem, expected = hollow chip on a faint stem, overdue = amber.
  const stateInk = (m: Mark) => {
    const themeRing = themeColor(m.theme ?? "other");
    if (m.state === "actual")
      return { stemOpacity: 1, stem: "var(--nb-ink)", ring: themeRing,
               chipFill: "var(--nb-panel-2)", initialInk: "var(--nb-text)" };
    if (m.state === "expected")
      return { stemOpacity: 0.35, stem: "var(--nb-ink)", ring: "var(--nb-ink)",
               chipFill: "var(--nb-bg)", initialInk: "var(--nb-muted)" };
    return { stemOpacity: 0.5, stem: "var(--nb-warn)", ring: "var(--nb-warn)",
             chipFill: "var(--nb-bg)", initialInk: "var(--nb-warn)" };
  };

  const empty = marks.length === 0 && pills.length === 0 && strip.length === 0;

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? "Recurring bills"}</h2>
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
      {!error && data && empty && <div className="status">No recurring activity this month.</div>}
      {!error && data && !empty && (
        <div className="body-fill">
          {(marks.length > 0 || pills.length > 0) && (
            <svg viewBox={`0 0 ${W} ${H}`} className="spend-cal-svg" role="img"
              aria-label="Recurring bills and income by day of month">
              {/* Recessive weekly gridlines + day axis */}
              {[1, 8, 15, 22, 29].map((d) => (
                <g key={d}>
                  <line x1={x(d)} y1={PAD.top - 8} x2={x(d)} y2={H - PAD.bottom}
                    stroke="var(--nb-border)" strokeWidth="1" opacity="0.45" />
                  <text x={x(d)} y={H - 8} textAnchor="middle" fill="var(--nb-muted)" fontSize="12">
                    {d}
                  </text>
                </g>
              ))}
              <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom}
                stroke="var(--nb-border)" strokeWidth="1" />

              {/* Today — live month only; history has no "now" */}
              {todayDay > 0 && (
                <>
                  <line x1={x(todayDay)} y1={16} x2={x(todayDay)} y2={H - PAD.bottom}
                    stroke="var(--nb-accent)" strokeWidth="1.5" opacity="0.75" />
                  <text x={x(todayDay)} y={12} textAnchor="middle" fill="var(--nb-accent)" fontSize="11">
                    today
                  </text>
                </>
              )}

              {marks.map((m) => {
                const st = stateInk(m);
                const cx = x(m.day) + (offsets.get(m.id) ?? 0);
                const cy = y(m.amount);
                // Near the edges the label anchors from the mark inward
                // instead of shifting sideways — a shifted label lands on the
                // neighboring mark and reads as its value.
                const anchor = cx < PAD.left + 34 ? "start" : cx > W - PAD.right - 34 ? "end" : "middle";
                const active = hover === m.id;
                const clipId = `clip-${m.id.replace(/\W+/g, "-")}`;
                return (
                  <g
                    key={m.id}
                    onMouseEnter={() => setHover(m.id)}
                    onMouseLeave={() => setHover(null)}
                    opacity={hover === null || active ? 1 : 0.35}
                    className="spend-cal-mark"
                  >
                    {/* stem: baseline → icon; height encodes cost */}
                    <line x1={cx} y1={H - PAD.bottom} x2={cx} y2={cy + ICON / 2 + 2}
                      stroke={st.stem} strokeWidth="2" strokeLinecap="round"
                      opacity={st.stemOpacity} />
                    {/* neutral chip; the thin ring wears the theme (or state) color */}
                    <circle cx={cx} cy={cy} r={ICON / 2 + 2} fill={st.chipFill} stroke={st.ring} strokeWidth="2" />
                    {m.logo && !broken.has(m.merchantKey) ? (
                      <>
                        <clipPath id={clipId}>
                          <circle cx={cx} cy={cy} r={ICON / 2} />
                        </clipPath>
                        <image
                          href={m.logo}
                          x={cx - ICON / 2}
                          y={cy - ICON / 2}
                          width={ICON}
                          height={ICON}
                          clipPath={`url(#${clipId})`}
                          onError={() => setBroken((b) => new Set(b).add(m.merchantKey))}
                        />
                      </>
                    ) : (
                      <text x={cx} y={cy + 5} textAnchor="middle" fill={st.initialInk}
                        fontSize="14" fontWeight="600">
                        {m.name.charAt(0).toUpperCase()}
                      </text>
                    )}
                    {!censored && (
                      <text x={cx} y={cy - ICON / 2 - 6} textAnchor={anchor} fill="var(--nb-text)" fontSize="12">
                        {m.state === "expected" ? "~" : ""}
                        {amt(m.amount, censored)}
                        {FREQ_TAG[m.frequency] ?? ""}
                      </text>
                    )}
                    {active && (
                      <text x={cx} y={H - PAD.bottom + 16} textAnchor={anchor}
                        fill="var(--nb-text)" fontSize="12" fontWeight="600">
                        {m.name}
                      </text>
                    )}
                    <title>
                      {`${m.name} — ${STATE_LABEL[m.state]}, day ${m.day}${censored ? "" : `: ${m.state === "actual" ? "" : "~"}${amt(m.amount, censored)}`} (${m.frequency})`}
                    </title>
                  </g>
                );
              })}

              {/* Income pills: own lane at the top, drawn last so a tall bill
                  can never cover them */}
              {pills.map((p) => {
                const px = x(p.day);
                const pillOpacity = p.state === "actual" ? 1 : p.state === "expected" ? 0.6 : 0.45;
                return (
                  <g key={p.id} opacity={pillOpacity}>
                    <circle cx={px} cy={PILL_Y} r={7}
                      fill={p.state === "actual" ? "var(--nb-green)" : "var(--nb-bg)"}
                      stroke="var(--nb-green)" strokeWidth="2" />
                    {!censored && (
                      <text x={px} y={PILL_Y + 18} textAnchor="middle" fill="var(--nb-green)" fontSize="10">
                        {amt(p.amount, censored)}
                      </text>
                    )}
                    <title>
                      {`${p.name} — income, ${STATE_LABEL[p.state]} (day ${p.day})${censored ? "" : `: ${amt(p.amount, censored)}`}`}
                    </title>
                  </g>
                );
              })}
            </svg>
          )}

          {strip.length > 0 && (
            <div className="spend-strip">
              {strip.map((s) => (
                <span key={`${s.merchant_key}-${s.is_income}`}
                  className={`spend-strip-item ${s.active ? "" : "lapsed"}`}
                  title={s.active ? `${s.frequency}, last on ${s.last_seen.slice(0, 10)}`
                    : `looks cancelled — last charged ${s.last_seen.slice(0, 10)}`}>
                  {s.merchant ?? s.merchant_key}
                  <span className="muted">
                    {censored ? ` ${s.frequency}` : ` ${amt(parseFloat(s.average_amount), censored)}/${
                      { weekly: "wk", biweekly: "2wk", monthly: "mo", quarterly: "qtr", annual: "yr" }[s.frequency]
                    }`}
                    {s.active ? "" : " · lapsed"}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
