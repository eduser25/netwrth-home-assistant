import { ComponentType } from "react";
import { Root, createRoot } from "react-dom/client";
import { Hass, listEntries } from "./lib/ha";
import { demoHass } from "./lib/demo";
import { ThemeMode, cardCss } from "./theme";
import { BaseCardConfig, OverlayContext } from "./cards/common";

type SchemaField = { name: string; label: string; selector: Record<string, unknown> };

export type CardDef = {
  tag: string;
  name: string;
  description: string;
  component: ComponentType<{ hass: Hass; config: any }>;
  defaults?: Record<string, unknown>;
  schema: SchemaField[];
  stub: Record<string, unknown>;
  size: number;
};

// Wraps a React card component as a Lovelace custom element: shadow DOM for
// style isolation, themed CSS injected per config, one React root per card.
export function defineCard(def: CardDef): void {
  class NetwrthCard extends HTMLElement {
    private _root?: Root;
    private _mount?: HTMLDivElement;
    private _overlay?: HTMLDivElement;
    private _style?: HTMLStyleElement;
    private _hass?: Hass;
    private _config?: BaseCardConfig;

    setConfig(config: BaseCardConfig) {
      this._config = { ...def.defaults, ...config } as BaseCardConfig;
      this._render();
    }

    set hass(h: Hass) {
      const first = !this._hass;
      this._hass = h;
      // hass updates on every HA state change; cards poll their own data, so
      // only the first assignment triggers a render.
      if (first) this._render();
    }

    connectedCallback() {
      this._render();
    }

    disconnectedCallback() {
      // Cards get detached/reattached while dashboards are edited; only
      // unmount if we're still gone a beat later.
      setTimeout(() => {
        if (!this.isConnected && this._root) {
          this._root.unmount();
          this._root = undefined;
          this._mount = undefined;
          this._overlay = undefined;
        }
      }, 100);
    }

    getCardSize(): number {
      return def.size;
    }

    // Sections view: the default cell is the masonry size, and the card can
    // be dragged down to three rows before the content stops fitting. The
    // chart area flexes to whatever height the cell gives it.
    getGridOptions() {
      return { columns: "full", rows: def.size, min_rows: 3, min_columns: 6 };
    }

    static getConfigElement() {
      return document.createElement(`${def.tag}-editor`);
    }

    static getStubConfig() {
      return { ...def.stub };
    }

    private _render() {
      if (!this._config || !this._hass || !this.isConnected) return;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      const shadow = this.shadowRoot!;
      if (!this._style) {
        this._style = document.createElement("style");
        shadow.appendChild(this._style);
      }
      this._style.textContent = cardCss((this._config.theme as ThemeMode) ?? "netwrth");
      if (!this._mount) {
        this._mount = document.createElement("div");
        this._mount.className = "mount";
        shadow.appendChild(this._mount);
        // Sibling of the card, outside its stacking context: PIN pad and
        // hover bubbles portal here so they float over neighbouring cards.
        this._overlay = document.createElement("div");
        this._overlay.className = "overlay";
        // Top layer when shown (see Overlay in cards/common.tsx).
        this._overlay.setAttribute("popover", "manual");
        shadow.appendChild(this._overlay);
        this._root = createRoot(this._mount);
      }
      const Component = def.component;
      // demo: true swaps the connection for the seeded sample dataset.
      const hass = this._config.demo ? demoHass() : this._hass;
      // Keyed on config so option changes reset in-card state (range, mode).
      this._root!.render(
        <OverlayContext.Provider value={this._overlay ?? null}>
          <Component key={JSON.stringify(this._config)} hass={hass} config={this._config} />
        </OverlayContext.Provider>
      );
    }
  }

  class NetwrthCardEditor extends HTMLElement {
    private _hass?: Hass;
    private _config?: Record<string, unknown>;
    private _entries?: { value: string; label: string }[];

    set hass(h: Hass) {
      this._hass = h;
      if (!this._entries) {
        listEntries(h)
          .then((entries) => {
            this._entries = entries.map((e) => ({ value: e.entry_id, label: e.title }));
            this._render();
          })
          .catch(() => {
            this._entries = [];
            this._render();
          });
      }
      this._render();
    }

    setConfig(config: Record<string, unknown>) {
      this._config = config;
      this._render();
    }

    private _schema(): SchemaField[] {
      return def.schema.map((f) =>
        f.name === "entry"
          ? {
              ...f,
              selector: {
                select: { options: this._entries ?? [], mode: "dropdown" },
              },
            }
          : f
      );
    }

    private _render() {
      if (!this._hass || !this._config) return;
      let form = this.querySelector("ha-form") as any;
      if (!form) {
        form = document.createElement("ha-form");
        form.addEventListener("value-changed", (ev: any) => {
          const config = { ...ev.detail.value };
          this.dispatchEvent(
            new CustomEvent("config-changed", {
              detail: { config },
              bubbles: true,
              composed: true,
            })
          );
        });
        this.appendChild(form);
      }
      form.hass = this._hass;
      form.data = this._config;
      form.schema = this._schema();
      form.computeLabel = (field: SchemaField) => field.label ?? field.name;
    }
  }

  customElements.define(def.tag, NetwrthCard);
  customElements.define(`${def.tag}-editor`, NetwrthCardEditor);

  const w = window as any;
  w.customCards = w.customCards || [];
  w.customCards.push({
    type: def.tag,
    name: def.name,
    description: def.description,
    preview: false,
    documentationURL: "https://github.com/eduser25/netwrth-home-assistant",
  });
}
