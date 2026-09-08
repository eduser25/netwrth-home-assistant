# netwrth-home-assistant (local dir: netwrth-hacs)

Home Assistant integration (`custom_components/netwrth/`) + React/Recharts Lovelace cards
(`cards/`) for the netwrth net-worth tracker. Amounts are censored server-side; the cards
render either real dollars or rescaled percent-of-total values.

## Build

```sh
cd cards && npm run typecheck && npm run build
```

The build writes the single bundle to `custom_components/netwrth/frontend/netwrth-cards.js`
(committed to the repo). The integration serves it and auto-registers it as a Lovelace
module resource with `?v=<manifest version>` as cache-buster — **bump `version` in
`custom_components/netwrth/manifest.json` on every frontend change** or browsers may keep
the old bundle.

## Deploy to the live HA instance

The test HA is https://hassio.in.purrhub.dev — HA Container running as Kubernetes
StatefulSet `hassio-0`, namespace `home-automation`, on the home cluster (manifests in
`~/src/home-cluster/kubernetes/apps/home-automation/hassio/`). netwrth is NOT installed
via HACS there; deploy by copying files into the pod (only port 443 is exposed — no SSH,
no Samba):

```sh
kubectl -n home-automation cp custom_components/netwrth hassio-0:/config/custom_components/
```

Then restart HA (`mcp__hass-mcp__restart_ha`, or service `homeassistant.restart`; the
MCP tool may report a pydantic output-validation error — the restart still fires) and
wait ~30–60 s until https://hassio.in.purrhub.dev responds again. kubectl allow-rules
live in `.claude/settings.local.json` (use the `kubectl -n home-automation …` argument
order so they match).

## Demo harness & README screenshots

`cards/demo/index.html` loads the built bundle with a fake `hass` serving seeded demo
data (Ridgeline Bank etc., PIN `1234`, `?censored=1` to start censored). Serve from the
repo root with `python3 -m http.server <port>` and open `/cards/demo/`; use
`window.setCards([[tag, config, width], …])` to stage any card/config combo. README
screenshots are captured from it via Claude-in-Chrome `zoom` on the card's bounding rect
(scale = 1568/window.innerWidth) with `save_to_disk`, then copied into `docs/img/`.
Backgrounded tabs only paint on capture — always take a throwaway capture first, then
the real one (otherwise charts come out empty).

## Testing the cards

- Test dashboard: **https://hassio.in.purrhub.dev/lovelace/netwrth** (all netwrth cards on
  one view). Use Claude-in-Chrome — the user's Chrome is already authenticated against HA.
- Hard-reload after a deploy (cmd+shift+r) so the new bundle ?v= is picked up.
- The `hass-mcp` MCP server talks to the same instance: entities
  (`sensor.netwrth_home_assistant_hassio_*`), error log (`get_error_log`,
  integration `netwrth`), service calls.
- Reveal/conceal: the lock button on any card; the PIN pad appears when a code is
  required. Reveal state is key-level and synced across cards/devices via an event.
- HA global quick-search steals plain keystrokes on dashboards — click into inputs
  (HACS/HA UI is deep shadow DOM; coordinates + screenshots work better than the
  accessibility tree, and `javascript_tool` can reach `document.querySelector('home-assistant').hass`
  for websocket calls).
