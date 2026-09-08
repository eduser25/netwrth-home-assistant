import { useMemo, useState } from "react";
import Ambient from "../components/Ambient";
import { Hass } from "../lib/ha";
import { MASK, money, moneyCompact, pct, signedMoney } from "../lib/format";
import { Account } from "../lib/types";
import { alignSeries, debtOfRow, sumRow } from "../lib/series";
import { RANGES, RangeKey } from "../lib/types";
import { VIEWS, ViewKey } from "../lib/views";
import {
  BaseCardConfig,
  LockControl,
  Segmented,
  useNetwrth,
  useVisibleAccounts,
  ambientEffect,
} from "./common";

export type StatCardConfig = BaseCardConfig & {
  view?: ViewKey;
  range?: RangeKey;
  show_controls?: boolean;
  show_range_selector?: boolean;
  // Composition bar under the number (uncensored only: composition is
  // exactly what censor mode hides). Default on.
  show_composition?: boolean;
  // "banner": one slim row — label, number, chip, composition bar — for a
  // full-width strip at the top of a dashboard. Default "card".
  layout?: "card" | "banner";
};

// The web hero's composition colors: one hue per part, shared across views.
const PART_COLORS: Record<string, string> = {
  Retirement: "#60a5fa",
  Taxable: "#818cf8",
  "Non-retirement": "#818cf8",
  Cash: "#34d399",
  Liquid: "#34d399",
  Debt: "#f472b6",
  "Credit cards": "#f472b6",
};

type Part = { label: string; v: number };

// What the view's total is made of, mirroring the web dashboard's hero parts.
function partsOf(view: ViewKey, values: Record<number, number>, accounts: Account[]): Part[] {
  const row = { ts: 0, values };
  const sum = (pick: (a: Account) => boolean) => sumRow(row, accounts, pick);
  if (view === "daily") {
    return [
      { label: "Liquid", v: sum((a) => a.kind === "cash") },
      { label: "Credit cards", v: sum((a) => a.kind === "credit") },
    ];
  }
  const retirement = sum((a) => a.category === "retirement");
  if (view === "invest") {
    return [
      { label: "Retirement", v: retirement },
      { label: "Taxable", v: sum((a) => a.category !== "retirement") },
    ];
  }
  const debt = debtOfRow(row, accounts);
  return [
    { label: "Retirement", v: retirement },
    { label: "Non-retirement", v: sum((a) => a.category !== "retirement" && (values[a.id] ?? 0) > 0) },
    { label: "Debt", v: debt },
  ];
}

function Composition({ parts }: { parts: Part[] }) {
  const drawn = parts.filter((p) => p.v !== 0);
  const totalAbs = drawn.reduce((s, p) => s + Math.abs(p.v), 0);
  if (drawn.length < 2 || totalAbs === 0) return null;
  return (
    <div className="comp">
      <div className="comp-bar">
        {drawn.map((p) => (
          <span
            key={p.label}
            style={{
              background: PART_COLORS[p.label] ?? "#8b9bb4",
              width: `${(Math.abs(p.v) / totalAbs) * 100}%`,
            }}
          />
        ))}
      </div>
      <div className="comp-legend">
        {drawn.map((p) => (
          <span className="comp-item" key={p.label}>
            <span className="comp-dot" style={{ background: PART_COLORS[p.label] ?? "#8b9bb4" }} />
            {p.label} <b>{moneyCompact(p.v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// One big number + its change over the window, styled like the web hero:
// the delta as a tinted chip, the composition bar underneath. Censored, the
// number stays masked but the percent change is real — that's the whole point.
export default function StatCard({
  hass,
  config,
}: {
  hass: Hass;
  config: StatCardConfig;
}) {
  const view = VIEWS.find((v) => v.key === (config.view ?? "all")) ?? VIEWS[2];
  const [range, setRange] = useState<RangeKey>(config.range ?? "1m");
  const { overview, series, masked, error, refresh } = useNetwrth(hass, config.entry, range);
  const visible = useVisibleAccounts(overview);
  const accounts = useMemo(() => visible.filter(view.pick), [visible, view]);

  const stat = useMemo(() => {
    if (!series) return null;
    const ids = new Set(accounts.map((a) => a.id));
    const rows = alignSeries(series.filter((s) => ids.has(s.account_id)));
    if (rows.length === 0) return null;
    const first = sumRow(rows[0], accounts);
    const last = sumRow(rows[rows.length - 1], accounts);
    return {
      last,
      diff: last - first,
      delta: first !== 0 ? (last - first) / Math.abs(first) : null,
      parts: partsOf(view.key, rows[rows.length - 1].values, accounts),
    };
  }, [series, accounts, view]);

  // Flow views (cash & credit) are dollars-only: the chip carries the $
  // change without a percent, like the web hero.
  const showDelta = stat != null && stat.delta != null;
  const banner = config.layout === "banner";

  return (
    <div className={`card${banner ? " stat-banner" : ""}`}>
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? view.label}</h2>
        <span className="head-right">
          {config.show_controls !== false && config.show_range_selector !== false && (
            <span className="controls">
              <Segmented options={RANGES} value={range} onChange={setRange} />
            </span>
          )}
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
      {!error && !stat && <div className="status">Loading…</div>}
      <div className={banner ? "stat-inline" : "stat-body"}>
      {!error && stat && masked && (
        // Censored: the dollar amount is redacted anyway, so promote the real
        // percent change to the big slot and drop the footer line entirely.
        <div
          className={`stat-value ${
            showDelta && !view.flow ? (stat.delta! >= 0 ? "up" : "down") : ""
          }`}
        >
          {showDelta && !view.flow ? pct(stat.delta!) : MASK}
        </div>
      )}
      {!error && stat && !masked && (
        <>
          <div className="stat-value">{money(stat.last)}</div>
          {showDelta && (
            <div className="stat-delta">
              <span className={`chip ${stat.diff >= 0 ? "up" : "down"}`}>
                {signedMoney(stat.diff)}
                {!view.flow && ` (${pct(stat.delta!)})`}
              </span>
              <span>over {range}</span>
            </div>
          )}
          {config.show_composition !== false && <Composition parts={stat.parts} />}
        </>
      )}
      </div>
    </div>
  );
}
