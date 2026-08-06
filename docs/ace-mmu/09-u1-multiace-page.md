# 09 · U1 + multiACE page — design & behaviour spec

> **Status: v1 built (2026-08-06).** The page renders as a `wxWebView`
> (`AceMmuPanel`) loading `resources/web/multiace/index.html`, fed live data from
> `AceSnapshot` via `window.setAceState(json)`. This document is the reference for
> the whole page: every region, every control, what it does, its data source, and
> whether it is done / stubbed / blocked. Design record:
> `docs/ace-mmu/u1-multiace-page.html` (artifact).

## Architecture (how the page is driven)

- **Host → page:** `AceMmuPanel::push_state()` fetches the `AceSnapshot`
  (`AceMmuProvider`), serialises it (nlohmann::json) and calls
  `window.setAceState(json)`. Runs on webview load, on tab-switch (MainFrame
  calls `refresh()`), and on the page's Refresh button.
- **Page → host:** the page posts strings over the `wx` script-message channel
  (`window.wx.postMessage`) that `CreateWebView` already registers. `AceMmuPanel`
  handles `wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED`. Current messages: `refresh`,
  `dry:<unit>`, `heat:<unit>` (writes only logged for now).
- **Theme:** `state.dark` (from `GUI_App::dark_mode()`) sets `data-theme`.
- **Design source of truth is the HTML** — iterate there, C++ only feeds data.

## JSON contract (host → page)

```jsonc
{
  "dark": false, "connected": true, "mode": "head",
  "toolheads": [ { "idx":0, "material":"PLA", "color":"#f0483d", "brand":"",
                   "source":"rfid", "filament_detected":true, "feeder":true,
                   "ace":null } ],
  "units": [ { "idx":0, "protocol":"v2", "connected":true, "humidity":49,
               "temp":31, "dryer_min":0,
               "slots":[ { "idx":0, "occupied":true, "material":"PETG",
                           "color":"#83afff", "brand":"Kingroon",
                           "source":"rfid" } ] } ]
}
```
Fields still to add (see Open items): per-spool `nozzle`, `bed`, `colorname`.

---

## Page regions & controls

### A. Panel header
| Element | Action | Behaviour | Source | Status |
|---|---|---|---|---|
| Title "Filament" | — | Static label | — | done |
| ↻ Refresh | click | Re-pull inventory (`postMessage("refresh")` → `push_state`) | live | done |

### B. Feed-path diagram
The heart of the page: **sources on top → wires → toolheads at the bottom.**

**B1. Direct feeder spools** (one per toolhead with `feeder && filament_detected`)
| Element | Action | Behaviour | Source | Status |
|---|---|---|---|---|
| Spool card | click | Opens **view** (rfid) or **edit** (else) sheet | toolhead | done |
| Colour ring / material / "Feeder" tag | — | Shows the head's direct filament | toolhead | done |
| view/edit icon | — | Affordance only (whole card is the hit target) | — | done |

**B2. ACE unit tray** (one box per unit)
| Element | Action | Behaviour | Source | Status |
|---|---|---|---|---|
| Badge `A<n>` + model + connected | — | Unit identity | unit | done |
| Humidity pill (ring + %) | — | Live relative humidity | `unit.humidity` | done |
| Temp pill (°C) | — | Live internal temperature | `unit.temp` | done |
| Dryer pill | — | `Off` / `<temp> · <time>` when running | `unit.dryer_min` | read done |
| **◈ Dry / ■ Stop** button | click | Off→open drybar; running→**stop drying** | write | **blocked** |
| Drybar: temp 45/55/65 °C | click | Select dry temperature | UI | done |
| Drybar: duration 2/4/6 h | click | Select dry duration | UI | done |
| Drybar: **Start drying** | click | Start dryer at temp/duration; flips button to Stop | write | **blocked** |
| Slot spools (occupied) | click | view (rfid) / edit (override) sheet | slot | done |
| Slot spools (empty) | click | edit → assign filament | write | partial |

**B3. Wires** — bezier curves source→head, colour = filament, animated flow.
Feeder → its head; ACE-fed head → its `head_ace` unit box. Status: done (recomputed
on resize / drybar toggle). Respects reduced-motion.

**B4. Toolheads** (bottom cartridges T1..T4) — inert status only (colour disc,
material band, nozzle). No interaction by design. Status: done.

**B5. Empty state** — "No ACE unit detected…" when `!connected` / no units. done.

### C. View sheet (read-only) — opens for RFID/trusted spools
Mirrors Snapmaker's filament detail screen.
| Row | Value | Source | Status |
|---|---|---|---|
| Filaments | `<brand> <material>` | slot/toolhead | done (brand only for slots) |
| Colors | colour dot | `color` | done |
| Extruder Temp. | e.g. `230°C – 260°C` | filament preset | **TODO** (shows — ) |
| Heated Bed Temp. | e.g. `50°C` | filament preset | **TODO** (shows — ) |
| ✕ / Esc / backdrop | close | — | done |

### D. Edit sheet — opens for override/derived/empty spools
Mirrors Snapmaker's colour/filament picker.
| Element | Action | Behaviour | Status |
|---|---|---|---|
| Colors row (name + radio) | — | Current colour name | partial (name = — ) |
| **Filaments `›`** | click | Open a filament-**preset** list (brand/material) | **TODO** |
| Colour swatch grid | click | Select a colour | UI done; **write blocked** |
| ✕ / Esc / backdrop | close | — | done |

---

## Open items (prioritised)

1. **multiACE control endpoints (writes) — the main blocker.** Need the printer's
   routes for: start/stop dryer (+ temp/duration), set slot colour, assign/clear
   slot filament. Discover from the U1 (LAN) or firmware. Until known, D-grid,
   Start/Stop drying, and empty-slot assign stay UI-only (posted + logged).
2. **View-sheet temps (C).** Match each spool's `material` (and preset id if the
   slot carries one) to an Orca filament preset and inject `nozzle`/`bed` so the
   view sheet shows real ranges instead of `—`. Pure read — do next.
3. **Edit-sheet Filaments list (D).** The `›` opens a preset picker (Orca's
   filament library, filtered to compatible). Selection feeds the write in (1).
4. **`colorname`.** Nearest named colour for the Colors row.
5. **Multi-unit.** Renderer already stacks N trays; verify with 2+ units on LAN.
6. **Async fetch.** `fetch_once()` runs on the UI thread in `push_state()`; move
   to a worker to avoid a brief stall on slow LAN.

## Non-goals for this page
- Camera stream and motion/jog controls — those belong to the real Snapmaker
  Device webview, not this multiACE view. Not reproduced here.
