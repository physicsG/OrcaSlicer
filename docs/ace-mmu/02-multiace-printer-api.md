# 02 · multiACE Printer-Side API Reference

Everything here was read from the multiACE source
([decay71/multiACE](https://github.com/decay71/multiACE)); file paths are within
that repo unless noted. This is the contract the Orca provider consumes.

## 2.1 Network topology & auth

From `multiace/web/README.md`, `multiace/web/deploy/multiace-web.nginx.conf`,
`multiace/web/deploy/S98multiace-web`:

```
Browser / Slicer
      │  HTTPS
      ▼
 nginx :80/:443 ──┬──► /              (Mainsail/Fluidd)
                  ├──► /server/...    (Moonraker :7125)
                  └──► /multiace/      (FastAPI :7126, this service)
```

- The FastAPI service binds **`127.0.0.1:7126`** (loopback only); it is reached
  from the network **only** through nginx at `https://<printer-ip>/multiace/`.
- The nginx location strips the `/multiace/` prefix
  (`proxy_pass http://127.0.0.1:7126/;`), so a route the code declares as
  `/api/state` is reached externally as **`/multiace/api/state`**.
- **Auth:** nginx applies `auth_request /auth_check` → Moonraker `/access/user`.
  The FastAPI app trusts any request that passes nginx (no per-app token). So the
  Orca client must satisfy Moonraker auth the same way Fluidd/Mainsail do
  (Moonraker one-shot token / API key, or trusted-client IP). See
  [§2.7](#27-auth-implications-for-the-orca-client).
- Environment (from `S98multiace-web`): `MOONRAKER_URL=http://127.0.0.1:7125`,
  `MULTIACE_CFG_PATH=/home/lava/printer_data/config/extended/ace.cfg`.

> **Note on the post-processor precedent.** multiACE's own
> `post_process_virtual_toolheads.py` reaches the API over **plain HTTP on port
> 80** at path `/multiace/api/state` (`lookup_live_slots(host, port=80,
> path='/multiace/api/state')`). So an unauthenticated `http://<ip>/multiace/api/state`
> is expected to work on typical installs; the Orca client should support both.

## 2.2 REST endpoints (prefix externally with `/multiace`)

Declared in `multiace/web/backend/main.py`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | `{status:"ok", version, ts}` liveness |
| GET | `/api/version` | `{web, moonraker_url, config_path, frontend_dir, printer:{device_name, machine_type, firmware_version}}` |
| GET | `/api/state` | **Full state** — `aces[]`, `toolheads[]`, `wiring[]`, `active_device`, `device_count`, `mode`, `dryer`, `bg_swap`, … |
| GET | `/api/aces` | Subset: `{aces:[...], active_device}` |
| GET | `/api/debug` | Raw Moonraker object dump (for diagnostics) |
| GET | `/api/materials` | `{materials:[...], db:{type:{vendor:[subtype,...]}}}` from firmware filament DB |
| GET | `/api/macros` | Auto-discovered ACE `gcode_macro`s, bucketed (switch/load/unload/dry/mode/status) |
| POST | `/api/macro` | Run one macro/gcode: body `{name, args:{K:V}}` → Moonraker `/printer/gcode/script` |
| POST | `/api/macro-batch` | Run several: body `{commands:[{name,args}]}` |
| GET/PUT | `/api/config` | Read/write `ace.cfg` (returns `{content, params, per_ace_params}`) |
| GET/POST/DELETE | `/api/slot-override[...]` | Manual slot identity overrides |
| GET/POST | `/api/snapshots[...]` | Saveable filament loadouts |
| POST | `/api/preflight`, `/api/preflight/print`, GET `/api/preflight/print/status` | Server-side gcode analysis / remap |
| GET | `/api/plugin-api/state`, `/api/plugin-api/aces` | Same shapes as `/api/state`, `/api/aces` (plugin surface) |
| POST | `/api/plugin-api/gcode` | Pass-through gcode `{script}` |
| POST | `/api/head-manual`, `/api/head-feeder`, `/api/head-ace` | Toggle head modes |
| WS | `/ws` (ext: `/multiace/ws`) | Live push, see [§2.4](#24-websocket-push) |

For the provider, the essential reads are **`/api/state`** (or `/api/aces`) and
the WebSocket; the essential write path is **`/api/macro`** /
`/api/plugin-api/gcode`.

## 2.3 JSON schema — `/api/state` and `/api/aces`

Produced by `_parse_state()` in `main.py`. Top-level (from `/api/state`):

```jsonc
{
  "ace_status": <int|null>,
  "ace_temp": <number|null>,
  "printer_state": "idle|busy|printing|paused|complete|error",
  "active_device": 0,          // currently-selected ACE index
  "device_count": 3,           // number of ACE units (from ace.cfg ace_device_count)
  "mode": "normal|multi|head",
  "ace_head": 3,
  "ace_heads": [ ... ],
  "head_feeder": { ... },
  "head_ace": { ... },
  "swap_in_progress": false,
  "dryer": { ... },
  "aces": [ /* see below */ ],
  "toolheads": [ /* see below */ ],
  "wiring": [ { "ace": 0, "slot": 0, "toolhead": 0, "color": "#rrggbb", "material": "PLA" } ],
  "save_variables": { ... },
  "bg_swap": { "available": bool, "version": ..., "enabled_heads": [...], "busy": [...] }
}
```

`/api/aces` returns only `{ "aces": [...], "active_device": N }`.

### `aces[]` — one entry per ACE unit

```jsonc
{
  "idx": 0,                 // ACE index 0..3  -> maps to Ams.id
  "connected": true,        // bool|null
  "protocol": "v2",         // "" | v1 | v2  (ACE Pro vs ACE 2 Pro)
  "status": <ace status>,
  "temp": <number|null>,    // internal temperature
  "humidity": 3,            // 1..5 bucket (or raw depending on unit)
  "dryer": { ... },         // dryer_status: temp, remaining, running, ...
  "feed_assist": -1,        // -1 = none/unknown
  "slots": [ /* exactly 4 */ ]
}
```

### `slots[]` — one entry per slot (SLOT_COUNT = 4)

```jsonc
{
  "idx": 0,                        // slot index 0..3  -> maps to AmsTray.id
  "state": "ready",                // empty|ready|loading|unloading|error|feeding|assist|unknown
  "raw": 1,                        // gate_status int (0 = empty)
  "status": "<raw ace status str>",
  "rfid": 2,                       // 0 = none, 2 = RFID read OK
  "material": "PLA",               // filament type
  "brand": "Anycubic",             // vendor
  "sku": "",                       // vendor SKU
  "subtype": "",                   // e.g. Matte / Silk
  "color": "#ff0000",              // "#rrggbb" or null
  "color_rgb": [255, 0, 0],        // [r,g,b] or null
  "rfid_data": { "material","brand","sku","subtype","color" } | null,
  "source": "rfid"                 // rfid | override | derived | empty | null
}
```

Semantics that matter to the provider:

- **A slot is occupied** when `state != "empty"` and `raw != 0`.
- **Trustworthy identity** comes from `source in ("rfid","override")`. multiACE's
  own post-processor filters live slots to exactly these (`lookup_live_slots`).
  `"derived"` means the identity was inferred from the print job, not the spool.
- `color` is a lowercase `#rrggbb`; the AMS model stores colour as an 8-hex
  `RRGGBBAA` string, so append `FF` for alpha (see field-mapping table in
  [04-provider-design.md](04-provider-design.md)).

### `toolheads[]` — one per physical extruder (4)

```jsonc
{
  "idx": 0, "name": "T0",
  "ace": 0|null, "slot": 0|null,          // which (ACE,slot) currently feeds this head
  "filament_detected": true,
  "filament_in_ace": ..., "filament_in_toolhead": ..., "filament_at_extruder": ...,
  "channel_state": "...", "channel_error": "...", "module_exist": ...,
  "color": "#rrggbb"|null, "material": "PLA", "subtype": "", "sku": "", "brand": "",
  "head_source_known": true,
  "manual": false,   // hand-fed / TPU bypass (no ACE)
  "feeder": false,   // stock feeder mode (head mode only)
  "source": "rfid|override|derived|null"
}
```

`toolheads[]` is the *loaded* view (which slot is currently at each head). For
inventory we use `aces[].slots[]`; `toolheads[]` is useful for live status
(which slot is active) and for the `manual`/`feeder` guards.

## 2.4 WebSocket push

`GET /multiace/ws` (nginx upgrades to the FastAPI `/ws`). Behaviour:

- Every ~1 s it sends the **entire `_parse_state()` payload** plus
  `{"type":"state","ts":<epoch>}`.
- On Klipper errors it also sends `{"type":"gcode_error","id","ts","msg","raw","level"}`.
- On disconnect it may send `{"type":"state","klippy":"disconnected"}`.

The provider should prefer the WebSocket for live updates and fall back to
polling `/api/state` (e.g. every 2–5 s) if the socket is unavailable.

## 2.5 Underlying Moonraker objects (direct alternative)

`_query_state()` queries:

```
GET /printer/objects/query?ace&filament_feed%20left&filament_feed%20right&save_variables&print_task_config&print_stats&idle_timeout&ace_bg_swap
```

The raw `ace` object exposes (subset, as consumed by `_parse_state`):
`device_count`, `active_device`, `head_source{t:…}`, `head_manual`,
`head_feeder`, `mode`, `ace_head`, `ace_heads`, `head_ace`,
`swap_in_progress`, `dryer_status`, and `aces[]` where each ACE has
`idx`, `connected`, `protocol`, `status`, `temp`, `humidity`, `dryer_status`,
`feed_assist`, `gate_status[]`, and `slots[]` with
`{index, status, rfid, material|type, brand, sku, subtype, color:[r,g,b]}`.

**Trade-off:** hitting Moonraker directly (`/printer/objects/query`, or a
websocket `printer.objects.subscribe`) avoids depending on the multiACE FastAPI
service being installed, but then the provider must replicate the reshaping
logic in `_parse_state()` (RFID/override selection, colour conversion, gate→state
naming, humidity bucketing). Consuming the FastAPI `/api/state` is simpler and
already normalized. **Recommendation: consume `/multiace/api/state`; keep the
raw-Moonraker path as a documented fallback.**

## 2.6 Gcode command interface

Two ways to send:
- `POST /multiace/api/macro` `{ "name": "<CMD>", "args": { "HEAD": 0, "ACE": 1 } }`
- `POST /multiace/api/plugin-api/gcode` `{ "script": "<raw gcode line(s)>" }`
- (or Orca's existing MQTT `command_...` path — see §2.7).

Commands relevant to a slicer integration (from `ace.cfg` macros and `main.py`):

| Command | Args | Purpose |
|---------|------|---------|
| `ACE_SWAP_HEAD` | `HEAD=h ACE=a SLOT=s [ANTI_OOZE=v]` | Core toolchange: load slot `s` of ACE `a` onto head `h` |
| `ACE_LOAD_HEAD` | `HEAD=h [ACE=a]` | Load one head from (active/given) ACE |
| `ACE_UNLOAD_HEAD` | `HEAD=h` | Unload one head |
| `ACE_SWITCH` | `TARGET=N [AUTOLOAD=1]` | Switch active ACE unit |
| `ACE_CLEAR_HEADS` | — | Reset head-source bookkeeping |
| `ACE_SET_HEAD_ACE` | `HEAD=h ACE=a` | Bind a head to an ACE (head mode) |
| `ACE_SET_HEAD_MANUAL` | `HEAD=h ENABLE=0/1` | Manual/TPU bypass |
| `ACE_SET_HEAD_FEEDER` | `HEAD=h ENABLE=0/1` | Stock-feeder mode |
| `ACE_BG_SWAP` / `ACE_BG_UNLOAD` | `HEAD ACE SLOT ...` | Background (parked) swaps |
| `SET_PRINT_FILAMENT_CONFIG` | `CONFIG_EXTRUDER FILAMENT_TYPE FILAMENT_COLOR_RGBA VENDOR FILAMENT_SUBTYPE` | Push filament identity to head |
| Fluidd macros | `ACEA__Switch_0..3`, `ACEB__Load_0..3`, `ACEC__Unload_All`/`Unload_T0..3`/`Load_T0..3`, `ACED__Dry_Start_0..3`/`Dry_Stop`, `ACEF__Mode_Normal`/`Mode_Multi`, `ACEG__Status`/`List` | User-facing convenience wrappers |

For the slicer, the day-to-day path is: **the exported gcode already contains
`ACE_SWAP_HEAD` lines** (produced by post-processing of `T = ace*4+slot`), so the
slicer typically does not need to issue swap commands live. It may optionally
issue `ACEB__Load_*` / `ACE_SET_HEAD_ACE` etc. as UI convenience actions.

## 2.7 Auth implications for the Orca client

- Orca's existing **MQTT** connection to the U1 (`Moonraker_Mqtt`) is a separate,
  already-authenticated channel (access code / certs — see
  [03-orca-ams-data-model.md](03-orca-ams-data-model.md)). If ACE state can be
  requested/received over that channel, no new auth is needed. This is the
  cleanest long-term path (Option A/C).
- For the **HTTP/WS** path (Option B), the client must pass Moonraker's
  `auth_request`. Practical approaches, in order of preference:
  1. Plain `http://<ip>/multiace/api/state` if the install permits it (the
     bundled post-processor relies on this).
  2. Moonraker **trusted client** (LAN IP allow-list) — zero token.
  3. Moonraker **API key** / **one-shot token** (`/access/oneshot_token`) added
     as a header/query param, mirroring what Fluidd/Mainsail do.
- TLS on `https://<ip>/multiace/` is typically **self-signed**; the client needs
  a "trust this printer" path (reuse the U1's existing local-SSL handling; see
  `local_use_ssl_for_mqtt` on `MachineObject`).

## 2.8 `ace.cfg` (context, not directly consumed)

`[ace]` keys the provider may surface or reason about:
`ace_device_count (1..8)`, `enable_ace_v2`, `display_index_base`, `language`,
`ace_head`, dryer defaults (`dryer_temp`, `dryer_duration`,
`max_dryer_temperature`), plus per-ACE overrides via `[ace N]` sections or
suffixed keys (`load_length_N`, `retract_length_N`, `dryer_temp_N`). The
`device_count` here is also reflected in `/api/state.device_count`, which is the
authoritative "how many ACE units to expose" value.
