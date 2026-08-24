# Bundle inventory

Everything below is at `resources/web/flutter_web/` in this repo.

## Identity

| Field | Value | Source |
|---|---|---|
| App name | `orca` | `version.json` |
| Version | `2.3.26` | `version.json` |
| Build number | `20260813142841` | `version.json` |
| Package name | `orca` | `version.json` |
| Build id | `3bf924fcd55c18a0a3670b1d4d819c93` | `.last_build_id` |
| Flutter engine revision | `b8800d88be4866db1b15f8b954ab2573bba9960f` | `flutter_bootstrap.js` |
| **Renderer** | **`html`** | `flutter_bootstrap.js` |
| Bundle size | 36 MB total, `main.dart.js` = 5,265,242 bytes / 188,957 lines | — |

## The renderer matters

`buildConfig.renderer` is `html`, not `canvaskit`. The page is therefore composed of
**real DOM elements and inline SVG**, not pixels in a `<canvas>`. `canvaskit/` ships in
the bundle but is not the active path.

For reverse engineering this is the single biggest lever, and it compounds with
`PrinterWebView` enabling DevTools unconditionally: you can right-click the live Device
page, inspect the element tree, and read the layout directly. It also means an HTML
reimplementation is a like-for-like substitute rather than an approximation.

## What is *not* in the bundle

- **No source maps.** No `.map` files anywhere.
- **No deferred chunks.** No `.part.js` — the app is one monolithic `main.dart.js`.
- Identifiers are minified (`A.cA`, `B.aR`, `aFQ`). **String literals are not**, which is
  what makes the protocol recoverable.

## Dart dependencies

242 packages are credited in `assets/NOTICES`. Snapmaker's own internal packages use a
`lava_` prefix — "lava" is their internal codename:

| Package | Role |
|---|---|
| `lava_device_control` | **The Device page itself.** Ships its own assets (`assets/packages/lava_device_control/`) |
| `lava_device` | Device model / discovery |
| `lava_core` | Shared core |
| `lava_theme` | Design system |
| `lava_dialog` | Dialog components |
| `lava_logger` | Logging |

Third-party packages that shape the architecture:

| Package | Role |
|---|---|
| `mqtt5_client` | **MQTT 5 client** — confirms the printer transport |
| `dio`, `pretty_dio_logger` | HTTP client for the Snapmaker cloud REST API |
| `provider`, `get_it` | State management and service location |
| `web_socket_channel`, `web_socket` | WebSocket transport (legacy/HTTP Moonraker path) |
| `sentry_flutter`, `sentry` | Crash reporting |
| `sqflite`, `shared_preferences` | Local persistence |
| `video_player`, `chewie` | Camera / timelapse playback |
| `easy_localization` | i18n, backed by `assets/i10n/*.json` |

## Assets

144 entries in `AssetManifest.json`: 109 SVG, 13 WebP, 11 PNG, 9 JSON, 3 fonts.

| Asset | Why it matters |
|---|---|
| `assets/i10n/en.json` | 1,241-key UI string table — the complete user-visible vocabulary |
| `assets/i10n/zh-CN.json` | Chinese counterpart |
| `assets/files/deviceError.json` | Printer error-code table — see [error codes](../06-errors/01-live-error-catalogue.md) |
| `assets/packages/lava_device_control/assets/files/filament.json` | Filament catalogue used by the Device page |
| `assets/svgs/device/*` | ~45 icons that enumerate the Device page's feature set |
| `assets/svgs/extruder/iconExtruder{1..4}.svg` | Confirms the U1's four toolheads |
| `assets/images/device*.webp` | Connection-state illustrations (authorized, authorizing, rejected, no-network, no-response, not-connected, invalid-version) |

The device state illustrations are a compact spec of the connection state machine — see
[the connection state machine](../02-device-page/02-connection-state-machine.md).

## Leftovers in the shipping bundle

- A hard-coded internal Snapmaker host: `http://172.17.100.32:8100/api`.
- Pre-production cloud hosts: `pre.api.snapmaker.com`, `pre.api.snapmaker.cn`,
  `pre.id.snapmaker.com`.
- A **developer route menu** (version + build number, one button per route) built
  into the bundle. It navigates by named route (`/deviceControl`, `/preUpload`, …)
  and is separate from the `?path=` dispatcher — see
  [entry points](03-entry-points.md).
- Test-only routes: `/testDownloadFile`, `/testPrintUploadTask`.
- `manifest.json` is still the unedited Flutter template ("A new Flutter project").
