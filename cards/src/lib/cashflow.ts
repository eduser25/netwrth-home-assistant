// Vendored from the netwrth app repo: frontend/lib/cashflow.ts at 44ec2bc.
// Only the import path differs — re-sync as a straight copy when the web
// model changes, and keep the card (cards/CashFlowCard.tsx) in step with
// frontend/components/spending/CashFlow.tsx (832187a).

import type { Account, SpendingTxn } from "./types";

// Pure model behind the Spending tab's cash-flow Sankey: where the month's
// money came from (income sources, or savings when spending outran
// income) and where it went (spending themes, debt payments, or what was
// left over). No React, no colors — the component maps `theme` to a hue —
// so this stays runnable and checkable on its own.
//
// Conventions (same as the rest of the Spending tab):
// - amounts use the storage sign: positive = money out, negative = in;
// - "transfers" are own-pocket moves and never appear;
// - spending themes are summed NET (a refund lowers its theme), matching
//   the category bars; a theme that nets to ≤ 0 drops out;
// - pending rows count, like they do in the Spent/Income hero totals —
//   they are real money already committed this month;
// - censor mode needs nothing here: amounts arrive rescaled by the
//   server and every derived ratio survives the scaling.

export type CashFlowSide = "in" | "mid" | "out";

export type CashFlowNode = {
  key: string; // stable identity (theme name, merchant key, or a sentinel)
  name: string; // display label
  side: CashFlowSide;
  // Color key: a spending theme, or one of the sentinels below.
  theme: string;
  amount: number;
};

export type CashFlowLink = { source: number; target: number; value: number };

export type CashFlow = {
  nodes: CashFlowNode[];
  links: CashFlowLink[];
  income: number; // total income this month
  outflow: number; // spending + debt payments
  empty: boolean;
};

// Color sentinels the component resolves (not spending themes).
export const CF_INCOME = "@income";
export const CF_CASH = "@cash";
export const CF_SAVINGS = "@savings"; // "From savings" (left)
export const CF_LEFTOVER = "@leftover"; // "Left over" (right)
export const CF_DEBT = "@debt";

// Income sources shown by name; the rest fold into "Other income".
export const MAX_INCOME_SOURCES = 4;
// Spending themes below this share of total outflow fold into "Other".
export const MIN_THEME_SHARE = 0.03;
// Hard cap on named spending themes (after the share cut), so the right
// column stays readable on a phone.
export const MAX_SPEND_THEMES = 8;

const EPS = 0.005; // half a cent: below this a flow is noise

const NON_SPEND = new Set(["income", "transfers", "debt"]);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type AccountKind = Account["kind"];

/**
 * Builds the Sankey model from one month's transactions.
 *
 * `accountKinds` (account id → kind) sharpens the debt node: a
 * credit-card payment is excluded because the purchases it settles
 * already count as spending (counting both would show the same dollars
 * leaving twice). A debt outflow from a non-card account is treated as a
 * card payment when a card-side debt credit of the same amount shows up
 * this month; loan-account rows are mirrors of payments made elsewhere
 * and never count. Without kinds every positive debt row counts.
 */
export function buildCashFlow(
  txns: SpendingTxn[],
  accountKinds?: Map<number, AccountKind> | null
): CashFlow {
  const incomeBy = new Map<string, { name: string; amount: number }>();
  const themeBy = new Map<string, number>();
  const debtOut: number[] = []; // cents
  const cardCredits = new Map<number, number>(); // cents → count

  for (const tx of txns) {
    const a = parseFloat(tx.amount);
    if (!Number.isFinite(a) || a === 0) continue;
    const theme = tx.theme ?? "other";
    if (theme === "transfers") continue;
    if (theme === "income") {
      const k = tx.merchant_key || tx.description;
      const cur = incomeBy.get(k) ?? { name: tx.merchant ?? tx.description ?? k, amount: 0 };
      cur.amount += -a;
      incomeBy.set(k, cur);
      continue;
    }
    if (theme === "debt") {
      const kind = accountKinds?.get(tx.account_id);
      const cents = Math.round(Math.abs(a) * 100);
      if (kind === "loan") continue;
      if (kind === "credit") {
        if (a < 0) cardCredits.set(cents, (cardCredits.get(cents) ?? 0) + 1);
        continue;
      }
      if (a > 0) debtOut.push(cents);
      continue;
    }
    if (NON_SPEND.has(theme)) continue;
    themeBy.set(theme, (themeBy.get(theme) ?? 0) + a);
  }

  // Debt: drop outflows that pair with a card-side payment credit.
  let debt = 0;
  for (const c of debtOut) {
    const n = cardCredits.get(c) ?? 0;
    if (n > 0) {
      cardCredits.set(c, n - 1);
      continue;
    }
    debt += c / 100;
  }

  // Left column: income sources, biggest first.
  const sources = [...incomeBy.entries()]
    .filter(([, v]) => v.amount > EPS)
    .sort((x, y) => y[1].amount - x[1].amount);
  const income = sources.reduce((s, [, v]) => s + v.amount, 0);
  // Folding exactly one source into "Other income" hides a name for no
  // gain, so fold only when at least two would go.
  const shownSources = sources.length > MAX_INCOME_SOURCES + 1 ? sources.slice(0, MAX_INCOME_SOURCES) : sources;
  const restIncome = sources.slice(shownSources.length).reduce((s, [, v]) => s + v.amount, 0);

  // Right column: spending themes + debt payments.
  const themes = [...themeBy.entries()].filter(([, v]) => v > EPS);
  const spend = themes.reduce((s, [, v]) => s + v, 0);
  const outflow = spend + (debt > EPS ? debt : 0);

  const outs: CashFlowNode[] = [];
  let otherSpend = 0;
  const ranked = themes.filter(([t]) => t !== "other").sort((x, y) => y[1] - x[1]);
  for (const [t, v] of ranked) {
    if (outflow > 0 && v / outflow >= MIN_THEME_SHARE && outs.length < MAX_SPEND_THEMES) {
      outs.push({ key: `t:${t}`, name: titleCase(t), side: "out", theme: t, amount: v });
    } else {
      otherSpend += v;
    }
  }
  otherSpend += themeBy.get("other") ?? 0;
  if (debt > EPS) {
    outs.push({ key: "debt", name: "Debt payments", side: "out", theme: CF_DEBT, amount: debt });
  }
  outs.sort((x, y) => y.amount - x.amount);
  if (otherSpend > EPS) {
    outs.push({ key: "t:other", name: "Other", side: "out", theme: "other", amount: otherSpend });
  }

  const ins: CashFlowNode[] = shownSources.map(([k, v]) => ({
    key: `i:${k}`,
    name: v.name,
    side: "in",
    theme: CF_INCOME,
    amount: v.amount,
  }));
  if (restIncome > EPS) {
    ins.push({ key: "i:@other", name: "Other income", side: "in", theme: CF_INCOME, amount: restIncome });
  }

  // Balance the diagram: the surplus is kept, the shortfall came out of
  // savings (or went onto cards — the model can't tell, and either way
  // it is money the month's income didn't cover).
  const gap = income - outflow;
  if (gap > EPS) {
    outs.push({ key: "leftover", name: "Left over", side: "out", theme: CF_LEFTOVER, amount: gap });
  } else if (-gap > EPS) {
    ins.push({ key: "savings", name: "From savings", side: "in", theme: CF_SAVINGS, amount: -gap });
  }

  const empty = income <= EPS && outflow <= EPS;
  if (empty) return { nodes: [], links: [], income: 0, outflow: 0, empty };

  const cash: CashFlowNode = {
    key: "cash",
    name: "Cash",
    side: "mid",
    theme: CF_CASH,
    amount: Math.max(income, outflow),
  };
  const nodes = [...ins, cash, ...outs];
  const mid = ins.length;
  const links: CashFlowLink[] = [
    ...ins.map((n, i) => ({ source: i, target: mid, value: n.amount })),
    ...outs.map((n, i) => ({ source: mid, target: mid + 1 + i, value: n.amount })),
  ];
  return { nodes, links, income, outflow, empty };
}
