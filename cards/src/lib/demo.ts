import { Hass } from "./ha";

// Seeded sample data served in place of a netwrth connection. Powers the
// `demo: true` card option (preview a card before connecting, or stage a
// dashboard for screenshots without exposing real accounts) and the
// cards/demo harness. Deterministic: the same numbers every load, so
// screenshots are reproducible. PIN 1234 reveals after a conceal.

// Mulberry32.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400e3;
const END = Date.now();
const DAYS = 550;

type Def = [number, string, string, string, string | null, number, number, number];
// (id, name, org, kind, category, end balance, volatility, drift/day)
const DEFS: Def[] = [
  [1, "Checking", "Ridgeline Bank", "cash", null, 4770.06, 900, 0],
  [2, "Savings", "Ridgeline Bank", "cash", null, 30315.64, 60, 9],
  [3, "Brokerage", "Meridian Invest", "investment", "taxable", 97058.83, 850, 55],
  [4, "Index fund", "Meridian Invest", "investment", "taxable", 42415.54, 380, 26],
  [5, "Roth IRA", "Meridian Invest", "investment", "retirement", 38912.65, 330, 23],
  [6, "401(k)", "Summit Retirement", "investment", "retirement", 131359.55, 1100, 90],
  [7, "Credit card", "Ridgeline Bank", "credit", null, -1442.52, 350, 0],
  [8, "Travel card", "Harbor Credit Union", "credit", null, -925.68, 140, 0],
  [9, "Car loan", "Harbor Credit Union", "loan", null, -11041.33, 0, -14],
];

type TxnDef = [number, number, number, string, string];
// [account, day, amount, theme, merchant]
const TXN_DEFS: TxnDef[] = [
  [1, 1, 2200, "housing", "Maple St Apartments"],
  [1, 3, 11.99, "subscriptions", "Spotify"],
  [1, 5, -3100, "income", "Acme Payroll"],
  [1, 10, 15.49, "subscriptions", "Netflix"],
  [1, 18, 145.3, "utilities", "City Power & Gas"],
  [1, 19, -3100, "income", "Acme Payroll"],
  [7, 2, 84.12, "groceries", "Hillside Market"],
  [7, 6, 42.5, "dining", "Blue Fern Cafe"],
  [7, 9, 129.99, "shopping", "Northlane Outfitters"],
  [7, 13, 91.4, "groceries", "Hillside Market"],
  [7, 16, -650, "debt", "Payment - Thank You"],
  [7, 20, 36.2, "dining", "Taqueria El Sol"],
  [7, 25, 88.3, "groceries", "Hillside Market"],
  [7, 4, 58.4, "transport", "Ridgeline Fuel"],
  [7, 11, 27.9, "health", "Corner Pharmacy"],
  [7, 22, 64.8, "dining", "Lantern House"],
  [7, 27, 26.6, "shopping", "Paper & Twine"],
  [8, 4, 210.45, "travel", "Skyway Airlines"],
  [8, 14, -180, "debt", "Payment - Thank You"],
];

// Credit cards follow their own transactions instead of a random walk: the
// month's purchases step the debt up and the payment drops it, the same
// pattern every month, walked backwards from today's balance so "today"
// still matches DEFS. Balance is negative; undoing a purchase adds it back,
// undoing a payment takes it away again.
function creditSeries(def: Def) {
  const [id, , , , , end] = def;
  const monthly = TXN_DEFS.filter(([acct]) => acct === id);
  const pts: { ts: string; balance: string }[] = [];
  let v = end;
  for (let i = 0; i <= DAYS; i++) {
    const d = new Date(END - i * DAY);
    pts.push({ ts: d.toISOString(), balance: v.toFixed(2) });
    const day = d.getUTCDate();
    for (const [, tday, tv] of monthly) if (tday === day) v += tv;
    v = Math.min(0, v);
  }
  return { account_id: id, points: pts.reverse() };
}

function series(def: Def) {
  const [id, , , kind, , end, vol, drift] = def;
  if (kind === "credit") return creditSeries(def);
  const rand = rng(id * 7919);
  // Walk backwards from the end balance so "today" always matches.
  const pts: { ts: string; balance: string }[] = [];
  let v = end;
  for (let i = 0; i <= DAYS; i++) {
    pts.push({ ts: new Date(END - i * DAY).toISOString(), balance: v.toFixed(2) });
    v -= drift;
    v -= (rand() - 0.5) * 2 * vol;
    if (kind === "credit") v = Math.min(0, Math.max(v, end * 3 - 2000));
    if (kind === "loan") v = Math.min(v, 0);
  }
  return { account_id: id, points: pts.reverse() };
}

const ALL_SERIES = DEFS.map(series);
const NET = DEFS.reduce((s, d) => s + d[5], 0);

const accounts = DEFS.map(([id, name, org, kind, category, end]) => ({
  id,
  provider: "demo",
  org_domain: org.toLowerCase().replace(/\s/g, "") + ".com",
  org_name: org,
  name,
  nickname: null,
  currency: "USD",
  kind,
  category,
  hidden: false,
  balance: String(end),
  // Travel card renders the amber "stale" dot, everything else fresh.
  balance_at: new Date(END - (name === "Travel card" ? 3.2 * DAY : 0.05 * DAY)).toISOString(),
  created_at: new Date(END - DAYS * DAY).toISOString(),
}));

const RANGE_DAYS: Record<string, number> = { "1d": 1, "1w": 7, "1m": 30, "3m": 91, "6m": 183, "1y": 365, all: DAYS };

// ---- spending ----
const MONTH_NOW = new Date(END).toISOString().slice(0, 7);
const TODAY_DAY = new Date(END).getUTCDate();
const mday = (month: string, d: number) =>
  `${month}-${String(Math.max(1, Math.min(28, d))).padStart(2, "0")}`;

type StreamDef = [string, string, string, string, number, number, boolean, boolean];
// [key, name, theme, freq, day, avg, active, income]
const STREAM_DEFS: StreamDef[] = [
  ["RENT", "Maple St Apartments", "housing", "monthly", 1, 2200, true, false],
  ["SPOTIFY", "Spotify", "subscriptions", "monthly", 3, 11.99, true, false],
  ["NETFLIX", "Netflix", "subscriptions", "monthly", 10, 15.49, true, false],
  ["POWERGRID", "City Power & Gas", "utilities", "monthly", 18, 145.3, true, false],
  ["CARINS", "Beacon Auto Insurance", "transport", "monthly", 24, 118.5, true, false],
  ["PARKPASS", "Metro Parking Pass", "transport", "monthly", TODAY_DAY - 2, 62, true, false], // overdue sample
  ["GYM", "Ironworks Gym", "health", "weekly", 0, 24, true, false],
  ["HULU", "Hulu", "subscriptions", "monthly", 12, 17.99, false, false],
  ["PAYROLL", "Acme Payroll", "income", "biweekly", 5, 3100, true, true],
];


type Sub = (ev: { data: { entry_id: string } }) => void;

// One shared instance: every demo card on a page sees the same censor state,
// and a reveal in one refreshes the others through the censor event, exactly
// like the integration's real event does.
export function makeDemoHass(startCensored = false): Hass {
  let censored = startCensored;
  const subs = new Set<Sub>();
  const scale = (v: number) => (v / NET) * 100;
  const notify = () => {
    for (const s of subs) s({ data: { entry_id: "demo" } });
  };

  // Past months replay the full list; the live month cuts at "today".
  const monthTxns = (month: string) => {
    const live = month === MONTH_NOW;
    return TXN_DEFS.filter(([, day]) => !live || day <= TODAY_DAY).map(
      ([acct, day, v, theme, merchant], i) => ({
        id: i + 1,
        account_id: acct,
        posted_at: mday(month, day) + "T12:00:00Z",
        amount: (censored ? scale(v) : v).toFixed(2),
        currency: "USD",
        description: merchant.toUpperCase(),
        merchant,
        merchant_key: merchant.toUpperCase().replace(/\W+/g, " ").trim(),
        logo_url: null,
        category: null,
        theme,
        pending: false,
        theme_origin: "rule",
        logo_origin: "",
        merchant_renamed: false,
      })
    );
  };

  const spendingSummary = (month: string) => {
    const live = month === MONTH_NOW;
    const themes: Record<string, { total: number; count: number }> = {};
    let spend = 0;
    let income = 0;
    for (const [, day, v, theme] of TXN_DEFS) {
      if (live && day > TODAY_DAY) continue;
      themes[theme] = themes[theme] ?? { total: 0, count: 0 };
      themes[theme].total += v;
      themes[theme].count += 1;
      if (theme === "income") income += -v;
      else if (theme !== "debt" && theme !== "transfers" && v > 0) spend += v;
    }
    return {
      month,
      censored,
      themes: Object.entries(themes)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([theme, t]) => ({
          theme,
          total: (censored ? scale(t.total) : t.total).toFixed(2),
          count: t.count,
        })),
      total_spend: (censored ? scale(spend) : spend).toFixed(2),
      total_income: (censored ? scale(income) : income).toFixed(2),
    };
  };

  const spendingRecurring = (month: string) => {
    const live = month === MONTH_NOW;
    const sAmt = (v: number) => (censored ? scale(v) : v).toFixed(2);
    const streams = STREAM_DEFS.map(([key, name, theme, freq, day, avg, active, income]) => ({
      merchant_key: key,
      merchant: name,
      logo_url: null,
      theme,
      frequency: freq,
      day_of_month: day,
      interval_days: ({ weekly: 7, biweekly: 14, monthly: 30 } as Record<string, number>)[freq] ?? 30,
      average_amount: sAmt(avg),
      last_amount: sAmt(avg),
      first_seen: new Date(END - 270 * DAY).toISOString(),
      last_seen: new Date(END - (active ? 5 : 80) * DAY).toISOString(),
      count: 9,
      active,
      is_income: income,
      merchant_renamed: false,
    }));
    const actuals: unknown[] = [];
    const expected: unknown[] = [];
    for (const [key, name, , freq, day, avg, active, income] of STREAM_DEFS) {
      if (!active || freq === "weekly") continue;
      const days = freq === "biweekly" ? [day, day + 14] : [day];
      for (const d of days) {
        const overdueSample = key === "PARKPASS";
        if ((!live || d <= TODAY_DAY) && !overdueSample) {
          actuals.push({ merchant_key: key, date: mday(month, d), amount: sAmt(avg), is_income: income });
        } else if (live) {
          expected.push({
            merchant_key: key,
            merchant: name,
            frequency: freq,
            is_income: income,
            date: mday(month, d),
            amount: censored ? scale(avg) : avg,
            overdue: overdueSample,
          });
        }
      }
    }
    return {
      censored,
      month,
      today: live ? new Date(END).toISOString().slice(0, 10) : "",
      streams,
      expected,
      actuals,
    };
  };

  const hass = {
    connection: {
      async sendMessagePromise(msg: Record<string, unknown>): Promise<unknown> {
        const type = msg.type as string;
        if (type === "netwrth/overview") {
          return {
            entry_id: "demo",
            me: {
              label: "demo",
              scope: "read_full",
              censored,
              revealed: !censored,
              reveal_expires: null,
              code_required: true,
              can_reveal: true,
            },
            accounts: accounts.map((a) => ({
              ...a,
              balance: censored ? scale(parseFloat(a.balance)).toFixed(2) : a.balance,
            })),
            currency: "USD",
            default_reveal_ttl_minutes: 15,
          };
        }
        if (type === "netwrth/series") {
          const cut = END - (RANGE_DAYS[msg.range as string] ?? DAYS) * DAY;
          return {
            censored,
            series: ALL_SERIES.map((s) => ({
              account_id: s.account_id,
              points: s.points
                .filter((p) => new Date(p.ts).getTime() >= cut)
                .map((p) => ({
                  ts: p.ts,
                  balance: censored ? scale(parseFloat(p.balance)).toFixed(4) : p.balance,
                })),
            })),
          };
        }
        if (type === "netwrth/spending_summary") return spendingSummary((msg.month as string) ?? MONTH_NOW);
        if (type === "netwrth/spending_recurring") return spendingRecurring((msg.month as string) ?? MONTH_NOW);
        if (type === "netwrth/spending_transactions") {
          const month = (msg.month as string) ?? MONTH_NOW;
          let transactions = monthTxns(month);
          if (msg.theme) transactions = transactions.filter((t) => t.theme === msg.theme);
          return { month, censored, transactions };
        }
        if (type === "netwrth/reveal") {
          if (msg.code !== "1234") return { ok: false, error: "wrong code" };
          censored = false;
          notify();
          return { ok: true };
        }
        if (type === "netwrth/conceal") {
          censored = true;
          notify();
          return { ok: true };
        }
        if (type === "netwrth/entries") return [{ entry_id: "demo", title: "demo", scope: "read_full" }];
        throw new Error("unknown: " + type);
      },
      async subscribeEvents(cb: Sub) {
        subs.add(cb);
        return async () => {
          subs.delete(cb);
        };
      },
    },
  };
  return hass as unknown as Hass;
}

// The instance every `demo: true` card shares.
let shared: Hass | null = null;
export function demoHass(): Hass {
  if (!shared) shared = makeDemoHass(false);
  return shared;
}
