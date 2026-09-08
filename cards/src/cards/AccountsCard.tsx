import React, { useMemo, useState } from "react";
import Ambient from "../components/Ambient";
import { Hass } from "../lib/ha";
import { money, pct } from "../lib/format";
import { Account, RANGES, RangeKey } from "../lib/types";
import { VIEWS, ViewKey } from "../lib/views";
import {
  BaseCardConfig,
  LockControl,
  Segmented,
  isStale,
  useNetwrth,
  useVisibleAccounts,
  ambientEffect,
} from "./common";

export type AccountsCardConfig = BaseCardConfig & {
  view?: ViewKey;
  range?: RangeKey;
  show_controls?: boolean;
  show_range_selector?: boolean;
  // Only show accounts whose nickname or name matches one of these
  // (case-insensitive substring). Applied on top of the view filter.
  accounts?: string[];
};

const KIND_ORDER = ["cash", "investment", "credit", "loan", "other"] as const;

// Deterministic monogram gradient per institution (the web's account-card
// tile): same bank, same tile, on every card and device.
const MONO_GRADIENTS = [
  ["#3b82f6", "#2563eb"],
  ["#10b981", "#059669"],
  ["#8b5cf6", "#6366f1"],
  ["#f59e0b", "#d97706"],
  ["#ec4899", "#db2777"],
  ["#06b6d4", "#0891b2"],
] as const;

function monogram(a: Account) {
  const inst = a.org_name || a.org_domain || a.provider || "?";
  let hash = 0;
  for (let i = 0; i < inst.length; i++) hash = (hash * 31 + inst.charCodeAt(i)) | 0;
  const [g1, g2] = MONO_GRADIENTS[Math.abs(hash) % MONO_GRADIENTS.length];
  return { letter: inst.trim().charAt(0).toUpperCase() || "?", g1, g2 };
}

function balanceLabel(a: Account, masked: boolean): string {
  if (a.balance == null) return "–";
  const v = parseFloat(a.balance);
  return masked ? `${v.toFixed(1)}%` : money(v, true);
}

// The accounts table: grouped by kind, freshness dot per row. Censored,
// balances read as share of net worth.
export default function AccountsCard({
  hass,
  config,
}: {
  hass: Hass;
  config: AccountsCardConfig;
}) {
  const view = VIEWS.find((v) => v.key === (config.view ?? "all")) ?? VIEWS[2];
  const [range, setRange] = useState<RangeKey>(config.range ?? "1m");
  const { overview, series, masked, error, refresh } = useNetwrth(hass, config.entry, range);
  const visible = useVisibleAccounts(overview);
  const nameFilter = config.accounts;
  const accounts = useMemo(() => {
    let list = visible.filter(view.pick);
    if (nameFilter && nameFilter.length > 0) {
      const wanted = nameFilter.map((n) => n.trim().toLowerCase()).filter(Boolean);
      list = list.filter((a) =>
        wanted.some(
          (w) =>
            (a.nickname ?? "").toLowerCase().includes(w) ||
            a.name.toLowerCase().includes(w)
        )
      );
    }
    return list;
  }, [visible, view, nameFilter]);

  // Change over the selected window, per account. Censored values are
  // rescaled proportionally server-side, so the percent survives masking.
  const deltas = useMemo(() => {
    const m = new Map<number, number>();
    if (!series) return m;
    for (const s of series) {
      if (s.points.length < 2) continue;
      const pts = [...s.points].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );
      const first = parseFloat(pts[0].balance);
      const last = parseFloat(pts[pts.length - 1].balance);
      if (first !== 0) m.set(s.account_id, (last - first) / Math.abs(first));
    }
    return m;
  }, [series]);

  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        accounts: accounts.filter((a) => a.kind === kind),
      })).filter((g) => g.accounts.length > 0),
    [accounts]
  );

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? "Accounts"}</h2>
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
      {!error && !overview && <div className="status">Loading…</div>}
      {!error && overview && groups.length === 0 && (
        <div className="status">No accounts.</div>
      )}
      {!error && overview && groups.length > 0 && (
        <div className="body-scroll">
        <table>
          <tbody>
            {groups.map((g) => (
              <FragmentRows
                key={g.kind}
                kind={g.kind}
                accounts={g.accounts}
                masked={masked}
                deltas={deltas}
              />
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function FragmentRows({
  kind,
  accounts,
  masked,
  deltas,
}: {
  kind: string;
  accounts: Account[];
  masked: boolean;
  deltas: Map<number, number>;
}) {
  return (
    <>
      <tr className="kind-row">
        <td colSpan={3}>{kind}</td>
      </tr>
      {accounts.map((a) => {
        const delta = deltas.get(a.id);
        const mono = monogram(a);
        return (
          <tr key={a.id}>
            <td className="name-cell">
              <span
                className="mono"
                style={{ "--mono-a": mono.g1, "--mono-b": mono.g2 } as React.CSSProperties}
              >
                {mono.letter}
              </span>
              <span className="name-text">
                <span>{a.nickname || a.name}</span>
                <span className="muted">
                  <span className={`dot ${isStale(a.balance_at) ? "stale" : ""}`} />
                  {a.org_name || a.org_domain}
                </span>
              </span>
            </td>
            <td className="num">{balanceLabel(a, masked)}</td>
            <td className={`num row-delta ${delta == null ? "muted" : delta >= 0 ? "up" : "down"}`}>
              {delta == null ? "–" : pct(delta)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
