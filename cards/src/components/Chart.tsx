import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Account, ChartMode, RangeKey } from "../lib/types";
import { Row, debtOfRow, deltaSeries, flowSeries, sumRow } from "../lib/series";
import { money, moneyCompact, pct, shortDate, signedMoney } from "../lib/format";

export type { ChartMode };

// Y-axis width sized to what the ticks actually render (Recharts has no
// auto-fit), so the plot area claims the rest of the card.
function yAxisWidth(fmt: (v: number) => string, values: (number | null)[]): number {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (v == null || !isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let maxLen = 1;
  for (const v of [lo, hi]) maxLen = Math.max(maxLen, fmt(v).length);
  return Math.min(90, Math.ceil(maxLen * 7) + 14);
}

// Recharts' default margins add dead space on top of the axis width.
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

const PALETTE = [
  "#60a5fa", "#34d399", "#fbbf24", "#f472b6", "#a78bfa",
  "#22d3ee", "#fb923c", "#4ade80", "#e879f9", "#93c5fd",
];

// Chart chrome rides the card's tokens (SVG presentation attributes accept
// var()), so a Home Assistant theme restyles grid, axes and tooltip along
// with the card. Series hues stay literal: a color keeps its meaning.
const GRID = "var(--nb-border)";
const MUTED = "var(--nb-muted)";
const TEXT = "var(--nb-text)";
const ACCENT = "var(--nb-accent)";
const GREEN = "var(--nb-green)";
const RED = "var(--nb-red)";
const axisStyle = { fill: MUTED, fontSize: 12 };
const tooltipStyle = {
  backgroundColor: "var(--nb-panel-2)",
  border: "1px solid var(--nb-border)",
  borderRadius: 8,
  color: TEXT,
  fontSize: 13,
};

export default function Chart({
  rows,
  accounts,
  mode,
  range,
  masked = false,
  compact = true,
}: {
  rows: Row[];
  accounts: Account[];
  mode: ChartMode;
  range: RangeKey;
  masked?: boolean;
  compact?: boolean;
}) {
  const withTime = range === "1d" || range === "1w";
  const fmtX = (ts: number) => shortDate(ts, withTime);
  // Censored, total/category modes: series are rebased to "% change since the
  // window start" (first point = 0%), matching the stat-card percentages.
  // The stacked mode instead keeps the backend's %-of-net-worth scale, since
  // stacking per-account % changes would be meaningless.
  const rel = (v: number, base: number) =>
    base !== 0 ? (v - base) / Math.abs(base) : null;
  const axisMoney = compact ? moneyCompact : money;
  const fmtY = (v: number) => (masked ? pct(v) : axisMoney(v));
  const fmtVal = (v: number) => (masked ? pct(v) : money(v, true));

  if (mode === "flow") {
    const data = flowSeries(rows, accounts, range);
    const fmtFlow = (v: number) => (masked ? v.toFixed(2) : signedMoney(v));
    const fmtYFlow = (v: number) => (masked ? v.toFixed(1) : axisMoney(v));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={MARGIN}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="ts" tickFormatter={(ts) => shortDate(ts as number)} tick={axisStyle} minTickGap={40} />
          <YAxis tickFormatter={(v) => fmtYFlow(v as number)} tick={axisStyle} width={yAxisWidth(fmtYFlow, data.map((d) => d.flow))} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(ts) => shortDate(ts as number)}
            formatter={(v) => [fmtFlow(v as number), "Net flow"]}
            cursor={{ fill: GRID, fillOpacity: 0.4 }}
          />
          <Bar dataKey="flow" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.flow >= 0 ? GREEN : RED} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (mode === "total") {
    const base = sumRow(rows[0], accounts);
    const data = rows.map((r) => {
      const total = sumRow(r, accounts);
      return { ts: r.ts, total: masked ? rel(total, base) : total };
    });
    // Colour follows height: green at the top of the drawn line, blue at the
    // bottom (objectBoundingBox, relative to the path). A flat line has no
    // vertical extent and the gradient would not paint, so it stays solid.
    const totals = data.map((d) => d.total).filter((x): x is number => x != null && !isNaN(x));
    const flat = totals.length > 0 && Math.max(...totals) === Math.min(...totals);
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={MARGIN}>
          <defs>
            <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="nwline" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GREEN} />
              <stop offset="100%" stopColor={ACCENT} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="ts" tickFormatter={fmtX} tick={axisStyle} minTickGap={40} />
          <YAxis tickFormatter={fmtY} tick={axisStyle} width={yAxisWidth(fmtY, data.map((d) => d.total))} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(ts) => shortDate(ts as number, true)}
            formatter={(v) => [fmtVal(v as number), "Total"]}
          />
          <Area
            type="monotone"
            dataKey="total"
            stroke={flat ? ACCENT : "url(#nwline)"}
            strokeWidth={2.5}
            fill="url(#nw)"
            // Endpoint glow on the last point only; other points draw nothing.
            dot={(props: any) => {
              const { cx, cy, index, key } = props;
              if (index !== data.length - 1 || cx == null || cy == null) {
                return <g key={key} />;
              }
              return (
                <g key={key}>
                  <circle cx={cx} cy={cy} r={8} fill={GREEN} fillOpacity={0.25} />
                  <circle cx={cx} cy={cy} r={4} fill={GREEN} />
                </g>
              );
            }}
            activeDot={{ r: 4, fill: GREEN, stroke: "none" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (mode === "category") {
    const isRet = (a: Account) => a.category === "retirement";
    const bases = {
      retirement: sumRow(rows[0], accounts, isRet),
      other: sumRow(rows[0], accounts, (a) => !isRet(a)),
      debt: debtOfRow(rows[0], accounts),
    };
    const data = rows.map((r) => {
      const retirement = sumRow(r, accounts, isRet);
      const other = sumRow(r, accounts, (a) => !isRet(a));
      const debt = debtOfRow(r, accounts);
      return masked
        ? {
            ts: r.ts,
            retirement: rel(retirement, bases.retirement),
            other: rel(other, bases.other),
            debt: rel(debt, bases.debt),
          }
        : { ts: r.ts, retirement, other, debt };
    });
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={MARGIN}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="ts" tickFormatter={fmtX} tick={axisStyle} minTickGap={40} />
          <YAxis
            tickFormatter={fmtY}
            tick={axisStyle}
            width={yAxisWidth(fmtY, data.flatMap((d) => [d.retirement, d.other, d.debt]))}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(ts) => shortDate(ts as number, true)}
            formatter={(v, name) => [fmtVal(v as number), name as string]}
          />
          <Line type="monotone" dataKey="retirement" stroke={GREEN} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="other" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="debt" stroke={RED} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // (Animation is off on every mark above and below: rAF never fires on a
  // throttled background tab — wall panels, screenshot captures — and an
  // animated mark that never gets its first frame stays invisible.)
  // stacked: who moved the total — per-account balance changes per calendar
  // bucket, positives stacking up from the axis and negatives down
  // (stackOffset="sign"); the dotted trace is each bucket's net. Stacking
  // absolute balances just showed "the big account is big"; stacking deltas
  // answers the question people were opening this mode for. Censored,
  // deltas are percentage-point moves — geometry survives.
  const fmtDelta = (v: number) =>
    masked ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}` : signedMoney(v);
  const fmtYDelta = (v: number) => (masked ? v.toFixed(1) : axisMoney(v));
  const buckets = deltaSeries(rows, accounts, range);
  // Accounts that never moved in the window would only add zero-height
  // segments and tooltip noise.
  const moved = accounts.filter((a) =>
    buckets.some((b) => Math.abs(b.deltas[a.id] ?? 0) > 0.004)
  );
  const data = buckets.map((b) => {
    const d: Record<string, number> = { ts: b.ts, net: b.net };
    for (const a of moved) d[`a${a.id}`] = b.deltas[a.id] ?? 0;
    return d;
  });
  // Axis extent: each bucket's positive stack and negative stack.
  const stackExtent = buckets.flatMap((b) => {
    let pos = 0;
    let neg = 0;
    for (const a of moved) {
      const d = b.deltas[a.id] ?? 0;
      if (d >= 0) pos += d;
      else neg += d;
    }
    return [pos, neg];
  });
  const accLabel = (a: Account) => `${a.org_name || a.org_domain} · ${a.nickname || a.name}`;

  type TipEntry = { dataKey?: string | number; value?: number | string; color?: string };
  const DeltaTip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: TipEntry[];
    label?: number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const parts = payload
      .filter((p) => p.dataKey !== "net" && Math.abs(Number(p.value)) > 0.004)
      .sort((x, y) => Math.abs(Number(y.value)) - Math.abs(Number(x.value)));
    const net = payload.find((p) => p.dataKey === "net");
    return (
      <div style={{ ...tooltipStyle, padding: "8px 12px" }}>
        <div style={{ marginBottom: 4 }}>{shortDate(label ?? 0)}</div>
        {parts.map((p) => {
          const acc = moved.find((a) => `a${a.id}` === p.dataKey);
          return (
            <div key={String(p.dataKey)} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span style={{ color: p.color }}>{acc ? accLabel(acc) : String(p.dataKey)}</span>
              <span>{fmtDelta(Number(p.value))}</span>
            </div>
          );
        })}
        {net && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 4, color: MUTED }}>
            <span>net</span>
            <span>{fmtDelta(Number(net.value))}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} stackOffset="sign" margin={MARGIN}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
        <XAxis dataKey="ts" tickFormatter={(ts) => shortDate(ts as number)} tick={axisStyle} minTickGap={40} />
        <YAxis tickFormatter={fmtYDelta} tick={axisStyle} width={yAxisWidth(fmtYDelta, stackExtent)} />
        <Tooltip content={<DeltaTip />} cursor={{ fill: GRID, fillOpacity: 0.4 }} />
        <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.6} />
        {/* Animation off: sign-stacked bar rects don't materialize until the
            grow animation's first frame, which never comes on throttled
            background tabs (wall panels). */}
        {moved.map((a, i) => (
          <Bar
            key={a.id}
            dataKey={`a${a.id}`}
            stackId="delta"
            fill={PALETTE[i % PALETTE.length]}
            fillOpacity={0.8}
            isAnimationActive={false}
          />
        ))}
        <Line
          type="monotone"
          dataKey="net"
          stroke={TEXT}
          strokeWidth={1.5}
          strokeOpacity={0.65}
          strokeDasharray="4 3"
          dot={{ r: 2, fill: TEXT, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
