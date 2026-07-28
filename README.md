# Weight Map — MyGeotab Add-In

A live map that colours vehicles by cargo weight against a configurable threshold, using the **Generic cargo weight** status diagnostic. Runs on the logged-in MyGeotab session — no credentials stored.

## What it shows

- Leaflet map with every vehicle's live position (from `DeviceStatusInfo`):
  - **Red** — at or over the threshold (larger marker)
  - **Amber** — approaching (default ≥ 80% of threshold, adjustable)
  - **Green** — under
  - **Grey** — no weight reading in the last 24 h
- Click any marker for a popup: vehicle name, cargo weight in tonnes, % of threshold, reading age (flagged ⚠ if older than 60 min), and driving/stopped state.
- An "over threshold" table below the map, sorted heaviest first, with a link to that vehicle on the built-in MyGeotab live map.
- Toolbar: threshold in tonnes (default 10 t), warn %, filter (all / reporting only / over only), manual refresh, and a 60-second auto-refresh toggle (paused automatically when you leave the page).

## Data notes (hydrotech)

- The diagnostic reports in **grams**; the add-in converts to kg/tonnes (e.g. raw `13,194,000` → 13.19 t).
- Only 4 vehicles currently report it: REC002 and REC005 actively, COM114 and COM092 sending zeros. Everything else shows grey until weight sensors are fitted — the add-in deliberately does not treat "no data" as "under threshold".
- The diagnostic is resolved **by name at runtime** (`%generic cargo weight%`), so the same add-in works on other client databases; the hydrotech id (`aUHd4kxSPl0ichyMnPHhcLg`) is a hard-coded fallback.

## Files

- `weightmap.html` / `weightmap.css` / `weightmap.js` — the add-in (`geotab.addin.weightmap`)
- `config.json` — installation config

Leaflet 1.9.4 and OpenStreetMap tiles load from public CDNs.

## Deploy

1. Host the three files anywhere HTTPS-accessible (GitHub Pages works).
2. Replace `https://YOUR-HOST/weightmap-addin/` in `config.json` with the real URL.
3. MyGeotab → **Administration → System Settings → Add-Ins → New Add-In**, paste `config.json`, save.
4. "Weight map" appears under the Activity menu.

## Tuning

Constants at the top of `weightmap.js`:
- `WEIGHT_LOOKBACK_HOURS` (24) — how far back to search for a reading
- `STALE_MINUTES` (60) — when to flag a reading as stale
