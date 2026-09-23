import Ambient from "../components/Ambient";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sankey } from "recharts";
import { money, share } from "../lib/format";
import { Hass, fetchSpendingTransactions } from "../lib/ha";
import { Account, SpendingTxn } from "../lib/types";
import {
  CF_CASH,
  CF_DEBT,
  CF_INCOME,
  CF_LEFTOVER,
  CF_SAVINGS,
  CashFlowNode,
  buildCashFlow,
} from "../lib/cashflow";
import { BaseCardConfig, LockControl, Overlay, ambientEffect, useNetwrthCore } from "./common";
import { MonthNav, currentMonth, shiftMonth, themeColor } from "./spendingCommon";

// Monthly cash flow as a Sankey: income sources (and savings, when the
// month overspent) flow into one Cash node, which fans out into spending
// themes, debt payments and whatever was left over. Vendored from the app
// repo's frontend/components/spending/CashFlow.tsx; the model is the
// straight copy in lib/cashflow.ts — re-sync both when the web card changes.
//
// Censor mode: the transactions arrive rescaled server-side and the
// `censored` flag rides in the same response, so band widths stay honest
// while every label, bubble and the verdict print shares of income (of
// outflow when the month had no income) — never a dollar figure.

export type CashFlowCardConfig = BaseCardConfig & {
  // Month the card opens on: 0 = the live month, 1 = last month, …
  month_offset?: number;
  show_month_selector?: boolean;
};

const SENTINEL_COLORS: Record<string, string> = {
  [CF_INCOME]: "var(--nb-green)",
  [CF_CASH]: "var(--nb-ink)",
  [CF_LEFTOVER]: "var(--nb-green)",
  [CF_SAVINGS]: "var(--nb-warn)",
  [CF_DEBT]: "var(--nb-red)",
};
const nodeColor = (n: CashFlowNode) => SENTINEL_COLORS[n.theme] ?? themeColor(n.theme);

const NARROW = 560; // px: below this, labels stack on two lines and shrink

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

// Box size of the drawing area, kept current. 0×0 until measured. A
// callback ref: the box only mounts once data has arrived.
function useSize(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
    ro.current = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      const next = { w: Math.floor(r.width), h: Math.floor(r.height) };
      setSize((cur) => (cur.w === next.w && cur.h === next.h ? cur : next));
    });
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, size];
}

type Hover =
  | { kind: "node"; index: number; left: number; top: number }
  | { kind: "link"; index: number; left: number; top: number };

type Payload = { txns: SpendingTxn[] };

export default function CashFlowCard({
  hass,
  config,
}: {
  hass: Hass;
  config: CashFlowCardConfig;
}) {
  const [month, setMonth] = useState(() =>
    shiftMonth(currentMonth(), -Math.max(0, Math.floor(config.month_offset ?? 0)))
  );
  const [hover, setHover] = useState<Hover | null>(null);

  const fetchData = useCallback(
    (h: Hass, e: string | undefined) =>
      fetchSpendingTransactions(h, e, month).then((tx) => ({
        data: { txns: tx.transactions } as Payload,
        // The censor flag of the response that carried the amounts.
        censored: tx.censored,
      })),
    [month]
  );
  const { overview, data, masked, error, refresh } = useNetwrthCore<Payload>(
    hass,
    config.entry,
    fetchData
  );
  const censored = masked;

  // Account kinds let the model drop credit-card payments (their purchases
  // already count as spending) and loan-side mirrors. Every account counts
  // here, hidden or not: a hidden card's payment is still a card payment.
  const kinds = useMemo(
    () =>
      overview ? new Map<number, Account["kind"]>(overview.accounts.map((a) => [a.id, a.kind])) : null,
    [overview]
  );
  const flow = useMemo(() => buildCashFlow(data?.txns ?? [], kinds), [data, kinds]);

  const [boxRef, box] = useSize();
  const width = box.w;

  const narrow = width > 0 && width < NARROW;
  const base = flow.income > 0 ? flow.income : flow.outflow;
  const value = (v: number) => (censored ? share(v, base) : money(v));

  const nameMax = narrow ? 14 : 22;
  const label = (n: CashFlowNode) => truncate(n.name, nameMax);

  // Outer margins sized to the longest label on each side (rough glyph
  // width — SVG text can't be measured before it renders).
  const glyph = narrow ? 5.6 : 6.6;
  const sideWidth = (side: "in" | "out") => {
    const ls = flow.nodes
      .filter((n) => n.side === side)
      .map((n) =>
        narrow
          ? Math.max(label(n).length, value(n.amount).length)
          : label(n).length + 1 + value(n.amount).length
      );
    return Math.min(narrow ? 110 : 220, Math.ceil(Math.max(0, ...ls) * glyph) + 12);
  };
  const margin = { top: 22, bottom: 8, left: sideWidth("in"), right: sideWidth("out") };

  const perCol = Math.max(
    flow.nodes.filter((n) => n.side === "in").length,
    flow.nodes.filter((n) => n.side === "out").length
  );
  const nodePadding = narrow ? 26 : 16;
  // Natural height (the web card's): the drawing's flex basis, so a masonry
  // view gets exactly this and a sections cell stretches or squeezes it.
  const natural = Math.max(200, perCol * (narrow ? 44 : 32) + margin.top + margin.bottom);
  // Never squeeze below what the node padding alone needs.
  const height = Math.max(box.h, perCol * (nodePadding + 4) + margin.top + margin.bottom);

  // Recharts copies each node object into its layout; `payload` carries our
  // fields back into the renderers. Memoized so the layout only recomputes
  // when the data changes, not on every hover.
  const sankeyData = useMemo(
    () => ({ nodes: flow.nodes.map((n) => ({ ...n })), links: flow.links.map((l) => ({ ...l })) }),
    [flow]
  );

  const linkTouches = (li: number, ni: number) =>
    flow.links[li].source === ni || flow.links[li].target === ni;
  const linkActive = (li: number) =>
    !hover || (hover.kind === "link" ? hover.index === li : linkTouches(li, hover.index));
  const nodeActive = (ni: number) =>
    !hover ||
    (hover.kind === "node"
      ? hover.index === ni ||
        flow.links.some((_, li) => linkTouches(li, hover.index) && linkTouches(li, ni))
      : flow.links[hover.index].source === ni || flow.links[hover.index].target === ni);

  const move = (kind: Hover["kind"], index: number) => (e: React.MouseEvent) =>
    setHover({ kind, index, left: e.clientX + 14, top: e.clientY - 12 });
  const leave = () => setHover(null);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const renderNode = (p: any) => {
    const n = p.payload as CashFlowNode;
    const color = nodeColor(n);
    const active = nodeActive(p.index);
    const fs = narrow ? 10 : 12;
    let text: React.ReactNode;
    if (n.side === "mid") {
      text = (
        <text x={p.x + p.width / 2} y={p.y - 7} textAnchor="middle" fontSize={fs} fill="var(--nb-muted)">
          {n.name}
        </text>
      );
    } else {
      const outer = n.side === "in";
      const tx = outer ? p.x - 6 : p.x + p.width + 6;
      const anchor = outer ? "end" : "start";
      const cy = p.y + p.height / 2;
      text = narrow ? (
        <text x={tx} textAnchor={anchor} fontSize={fs} fill="var(--nb-text)">
          <tspan x={tx} y={cy - 2}>{label(n)}</tspan>
          <tspan x={tx} y={cy + fs} fill="var(--nb-muted)">{value(n.amount)}</tspan>
        </text>
      ) : (
        <text x={tx} y={cy + 4} textAnchor={anchor} fontSize={fs} fill="var(--nb-text)">
          {label(n)} <tspan fill="var(--nb-muted)">{value(n.amount)}</tspan>
        </text>
      );
    }
    return (
      <g
        opacity={active ? 1 : 0.35}
        onMouseMove={move("node", p.index)}
        onMouseLeave={leave}
        style={{ cursor: "default" }}
      >
        <title>{n.name}</title>
        <rect x={p.x} y={p.y} width={p.width} height={Math.max(1, p.height)} fill={color} rx={2} />
        {text}
      </g>
    );
  };

  const renderLink = (p: any) => {
    const src = p.payload.source as CashFlowNode;
    const tgt = p.payload.target as CashFlowNode;
    // Inflows take their source's hue, outflows their destination's.
    const color = nodeColor(tgt.side === "mid" ? src : tgt);
    const active = linkActive(p.index);
    return (
      <path
        d={`M${p.sourceX},${p.sourceY} C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`}
        fill="none"
        stroke={color}
        strokeWidth={Math.max(1, p.linkWidth)}
        strokeOpacity={hover ? (active ? 0.5 : 0.08) : 0.28}
        onMouseMove={move("link", p.index)}
        onMouseLeave={leave}
      />
    );
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // The month's verdict in one phrase, under the heading.
  const gap = flow.income - flow.outflow;
  const verdict =
    flow.income > 0 && gap >= 0
      ? `Kept ${censored ? share(gap, flow.income) : money(gap)}${censored ? " of income" : ` · ${share(gap, flow.income)} of income`}`
      : flow.income > 0
        ? `Spent ${censored ? `${share(-gap, flow.income)} more than` : `${money(-gap)} more than`} income`
        : "No income recorded this month";

  const bubble = (() => {
    if (!hover) return null;
    if (hover.kind === "node") {
      const n = flow.nodes[hover.index];
      if (!n) return null;
      return {
        title: n.name,
        rows: [
          ...(censored ? [] : [{ label: "amount", value: money(n.amount, true) }]),
          ...(flow.income > 0 ? [{ label: "of income", value: share(n.amount, flow.income) }] : []),
          ...(n.side === "out" && flow.outflow > 0 && n.key !== "leftover"
            ? [{ label: "of outflow", value: share(n.amount, flow.outflow) }]
            : []),
        ],
      };
    }
    const l = flow.links[hover.index];
    if (!l) return null;
    const s = flow.nodes[l.source];
    const t = flow.nodes[l.target];
    return {
      title: `${s.name} → ${t.name}`,
      rows: [
        ...(censored ? [] : [{ label: "amount", value: money(l.value, true) }]),
        ...(flow.income > 0 ? [{ label: "of income", value: share(l.value, flow.income) }] : []),
      ],
    };
  })();

  const ready = !error && data && overview;

  return (
    <div className="card">
      <Ambient effect={ambientEffect(config)} />
      <div className="head">
        <h2>{config.title ?? "Cash flow"}</h2>
        <span className="head-right">
          {config.show_month_selector !== false && (
            <MonthNav
              month={month}
              onChange={(m) => {
                setMonth(m);
                setHover(null);
              }}
            />
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
      {!error && !ready && <div className="status">Loading…</div>}
      {ready && flow.empty && (
        <div className="status">No income or spending recorded this month.</div>
      )}
      {ready && !flow.empty && (
        <>
          <div className="muted cashflow-verdict">{verdict}</div>
          <div className="cashflow-fill" style={{ flexBasis: natural }}>
            <div ref={boxRef} className="cashflow-box">
              {width > 0 && (
                <Sankey
                  width={width}
                  height={height}
                  data={sankeyData}
                  nameKey="name"
                  node={renderNode}
                  link={renderLink}
                  nodeWidth={10}
                  nodePadding={nodePadding}
                  linkCurvature={0.5}
                  iterations={32}
                  sort={false}
                  margin={margin}
                />
              )}
            </div>
          </div>
        </>
      )}
      {bubble && hover && (
        <Overlay>
          <div
            className="spend-hoverbubble"
            style={{ left: Math.min(hover.left, window.innerWidth - 240), top: hover.top }}
          >
            <div className="spend-bubble-title">{bubble.title}</div>
            <div className="spend-bubble-rows">
              {bubble.rows.map((r) => (
                <div key={r.label} className="spend-bubble-row">
                  <span className="muted">{r.label}</span>
                  <span>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
