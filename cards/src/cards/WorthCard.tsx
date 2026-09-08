import { useMemo, useState } from "react";
import Chart from "../components/Chart";
import Ambient from "../components/Ambient";
import { Hass } from "../lib/ha";
import { alignSeries } from "../lib/series";
import { ChartMode, RANGES, RangeKey } from "../lib/types";
import { VIEWS, ViewKey } from "../lib/views";
import {
  BaseCardConfig,
  LockControl,
  Segmented,
  useNetwrth,
  useVisibleAccounts,
  ambientEffect,
} from "./common";

export type WorthCardConfig = BaseCardConfig & {
  view?: ViewKey;
  mode?: ChartMode;
  range?: RangeKey;
  // Master switch for both selectors (legacy) plus per-selector overrides, so
  // a card can pin mode and/or range via config and hide either toggle.
  show_controls?: boolean;
  show_mode_selector?: boolean;
  show_range_selector?: boolean;
  // Short K/M notation on the y-axis (default on); tooltips stay exact.
  compact?: boolean;
};

// The flagship chart card: the web dashboard's views (day-to-day /
// investments / everything) and chart modes, rendered by the same code.
export default function WorthCard({
  hass,
  config,
}: {
  hass: Hass;
  config: WorthCardConfig;
}) {
  const view = VIEWS.find((v) => v.key === (config.view ?? "all")) ?? VIEWS[2];
  const [range, setRange] = useState<RangeKey>(config.range ?? "6m");
  const [mode, setMode] = useState<ChartMode>(
    config.mode && view.modes.includes(config.mode) ? config.mode : view.defaultMode
  );
  const { overview, series, masked, error, refresh } = useNetwrth(hass, config.entry, range);
  const visible = useVisibleAccounts(overview);
  const accounts = useMemo(() => visible.filter(view.pick), [visible, view]);

  const rows = useMemo(() => {
    if (!series) return [];
    const ids = new Set(accounts.map((a) => a.id));
    return alignSeries(series.filter((s) => ids.has(s.account_id)));
  }, [series, accounts]);

  const showControls = config.show_controls !== false;
  const showMode =
    showControls && config.show_mode_selector !== false && view.modes.length > 1;
  const showRange = showControls && config.show_range_selector !== false;

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? view.label}</h2>
        <span className="head-right">
          {(showMode || showRange) && (
            <span className="controls">
              {showMode && (
                <Segmented options={view.modes} value={mode} onChange={setMode} />
              )}
              {showRange && <Segmented options={RANGES} value={range} onChange={setRange} />}
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
      {!error && (!overview || !series) && <div className="status">Loading…</div>}
      {!error && overview && series && rows.length === 0 && (
        <div className="status">No data for this view yet.</div>
      )}
      {!error && overview && series && rows.length > 0 && (
        <div className="chart-fill">
          <Chart
            rows={rows}
            accounts={accounts}
            mode={mode}
            range={range}
            masked={masked}
            compact={config.compact !== false}
          />
        </div>
      )}
    </div>
  );
}
