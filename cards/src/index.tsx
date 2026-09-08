import AccountsCard from "./cards/AccountsCard";
import BillsCard from "./cards/BillsCard";
import CardCycleCard from "./cards/CardCycleCard";
import SpendingCard from "./cards/SpendingCard";
import StatCard from "./cards/StatCard";
import WorthCard from "./cards/WorthCard";
import { defineCard } from "./registerCard";

const themeField = {
  name: "theme",
  label: "Theme",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "netwrth", label: "netwrth (dark)" },
        { value: "ha", label: "Follow Home Assistant theme" },
      ],
    },
  },
};

const backgroundField = {
  name: "background",
  label: "Card background effect",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "plexus", label: "Plexus (default on the netwrth theme)" },
        { value: "mesh", label: "Mesh" },
        { value: "dots", label: "Dots" },
        { value: "contour", label: "Contour" },
        { value: "off", label: "Off (default when following the HA theme)" },
      ],
    },
  },
};

const demoField = {
  name: "demo",
  label: "Demo data (seeded sample, no connection needed — PIN 1234)",
  selector: { boolean: {} },
};

const entryField = { name: "entry", label: "netwrth connection", selector: {} };
const titleField = { name: "title", label: "Title", selector: { text: {} } };
const viewField = {
  name: "view",
  label: "View",
  selector: {
    select: {
      mode: "dropdown",
      options: [
        { value: "daily", label: "Day-to-day (cash + credit)" },
        { value: "invest", label: "Investments" },
        { value: "all", label: "Everything" },
      ],
    },
  },
};
const rangeField = {
  name: "range",
  label: "Default range",
  selector: {
    select: {
      mode: "dropdown",
      options: ["1d", "1w", "1m", "3m", "6m", "1y", "all"].map((r) => ({ value: r, label: r })),
    },
  },
};
const modeToggleField = {
  name: "show_mode_selector",
  label: "Show mode selector",
  selector: { boolean: {} },
};
const rangeToggleField = {
  name: "show_range_selector",
  label: "Show range selector",
  selector: { boolean: {} },
};
const concealField = {
  name: "auto_conceal_minutes",
  label: "Auto-conceal after reveal (minutes, 0 = stay revealed)",
  selector: { number: { min: 0, max: 43200, mode: "box" } },
};
const compactField = {
  name: "compact",
  label: "Short axis amounts ($1.2M instead of $1,200,000)",
  selector: { boolean: {} },
};

defineCard({
  tag: "netwrth-worth-card",
  name: "netwrth worth chart",
  description: "Your total over time — the netwrth dashboard chart.",
  component: WorthCard,
  schema: [
    titleField,
    entryField,
    viewField,
    {
      name: "mode",
      label: "Chart mode",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "total", label: "Total" },
            { value: "stacked", label: "What moved (stacked account changes)" },
            { value: "category", label: "Retirement vs taxable vs debt" },
            { value: "flow", label: "Net flow bars" },
          ],
        },
      },
    },
    rangeField,
    modeToggleField,
    rangeToggleField,
    compactField,
    concealField,
    themeField,
    backgroundField,
    demoField,
  ],
  stub: { view: "all", range: "6m" },
  size: 6,
  grid: () => ({ rows: 6, minRows: 3 }), // chart needs ~100px to read
});

defineCard({
  tag: "netwrth-flow-card",
  name: "netwrth net flow",
  description: "Money kept vs burned per day/week/month (day-to-day accounts).",
  component: WorthCard,
  defaults: { view: "daily", mode: "flow" },
  schema: [
    titleField,
    entryField,
    rangeField,
    modeToggleField,
    rangeToggleField,
    compactField,
    concealField,
    themeField,
    backgroundField,
    demoField,
  ],
  stub: { range: "3m" },
  size: 6,
  grid: () => ({ rows: 6, minRows: 3 }), // chart needs ~100px to read
});

defineCard({
  tag: "netwrth-stat-card",
  name: "netwrth stat",
  description: "One big number with its change over a window.",
  component: StatCard,
  schema: [
    titleField,
    entryField,
    viewField,
    rangeField,
    rangeToggleField,
    {
      name: "show_composition",
      label: "Show composition bar (uncensored)",
      selector: { boolean: {} },
    },
    {
      name: "layout",
      label: "Layout",
      selector: {
        select: {
          mode: "dropdown",
          options: [
            { value: "card", label: "Card (number over the bar)" },
            { value: "banner", label: "Banner (one slim row, for a full-width strip)" },
          ],
        },
      },
    },
    concealField,
    themeField,
    backgroundField,
    demoField,
  ],
  stub: { view: "all", range: "1m" },
  size: 2,
  // Banner: one slim row (HA grows the track to the content). Card: the
  // number, chip and composition bar need four rows, three without the bar;
  // it cannot go shorter without clipping, so the floor is the default.
  grid: (c) =>
    c.layout === "banner"
      ? { rows: 1, minRows: 1 }
      : c.show_composition === false
        ? { rows: 3, minRows: 3 }
        : { rows: 4, minRows: 4 },
});

defineCard({
  tag: "netwrth-accounts-card",
  name: "netwrth accounts",
  description: "Accounts grouped by kind with balances and sync freshness.",
  component: AccountsCard,
  schema: [
    titleField,
    entryField,
    viewField,
    rangeField,
    rangeToggleField,
    {
      name: "accounts",
      label: "Only these accounts (name match, empty = all)",
      selector: { text: { multiple: true } },
    },
    concealField,
    themeField,
    backgroundField,
    demoField,
  ],
  stub: { view: "all", range: "1m" },
  size: 4,
  grid: () => ({ rows: 6, minRows: 3 }), // list scrolls below its natural height
});

// Spending cards (per-user feature on the netwrth side: accounts without it
// see a "not enabled" note instead of data).

defineCard({
  tag: "netwrth-spending-card",
  name: "netwrth spending",
  description: "Where the month's money went: totals, share donut, and theme breakdown.",
  component: SpendingCard,
  schema: [
    titleField,
    entryField,
    {
      name: "show_stats",
      label: "Show Spent / Income / Recurring tiles",
      selector: { boolean: {} },
    },
    {
      name: "show_donut",
      label: "Show share-of-spending donut",
      selector: { boolean: {} },
    },
    concealField,
    themeField,
    backgroundField,
    demoField,
  ],
  stub: {},
  size: 6,
  grid: () => ({ rows: 5, minRows: 3 }), // list scrolls below its natural height
});

defineCard({
  tag: "netwrth-bills-card",
  name: "netwrth recurring bills",
  description: "Calendar of the month's bills and income — charged, expected, and overdue.",
  component: BillsCard,
  schema: [titleField, entryField, concealField, themeField, backgroundField, demoField],
  stub: {},
  size: 5,
  grid: () => ({ rows: 5, minRows: 3 }), // calendar drawing scales; 2 rows leaves it a sliver
});

defineCard({
  tag: "netwrth-cardcycle-card",
  name: "netwrth card credit",
  description: "Per credit card: balance through the month with payment markers.",
  component: CardCycleCard,
  schema: [titleField, entryField, concealField, themeField, backgroundField, demoField],
  stub: {},
  size: 4,
  grid: () => ({ rows: 4, minRows: 3 }), // cycle drawing scales; 2 rows leaves nothing
});

// The demo harness (cards/demo) drives cards with the same sample dataset.
export { makeDemoHass } from "./lib/demo";

// eslint-disable-next-line no-console
console.info("%c netwrth cards %c loaded", "background:#60a5fa;color:#0b0f17;border-radius:3px 0 0 3px;padding:1px 4px", "background:#17202f;color:#e6edf7;border-radius:0 3px 3px 0;padding:1px 4px");
