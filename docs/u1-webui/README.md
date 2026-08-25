# Snapmaker U1 embedded web UI — reverse engineering

Two of the surfaces Snapmaker Orca shows for a Snapmaker U1 are not native C++.
Both are the **same compiled Flutter web application**, shipped in this repo at
`resources/web/flutter_web/`, served over a loopback HTTP server and displayed in a
`wxWebView` at different routes.

| Surface | Route | Host window | Docs | Reconstruction |
|---|---|---|---|---|
| **Device tab** | `?path=2` | [`PrinterWebView`](../../src/slic3r/GUI/PrinterWebView.cpp) | [`02-device-page/`](02-device-page/) | `resources/web/device_page/` |
| **Print processing** — upload and print | `?path=4` | [`WebPreprintDialog`](../../src/slic3r/GUI/WebPreprintDialog.cpp) | [`03-print-processing/`](03-print-processing/) | `resources/web/print_processing/` |
| **Print processing** — upload only | `?path=5` | the same dialog | [`03-print-processing/`](03-print-processing/) | same, `?mode=upload` |

Each surface has its own documentation folder and its own reconstruction. What they
have in common is factored out explicitly — see
[what the two surfaces share](00-shared/01-shared-models.md).

**Orca loads the reconstructions by default** on this branch. The shipped Flutter pages
are one config flag away — see
[serving the reconstructions in Orca](00-shared/03-serving-in-orca.md), which also lists
what the reconstructions do not cover.

**Continuing this work?** Start at [`STATUS.md`](STATUS.md) — what is proven against
real hardware, what is not, and what to pick up next. If you are about to *change* the
Device page, read
[how it is put together](STATUS.md#how-the-device-page-is-put-together) first: it is one
directory per panel now, and the tooling checks that a command is reachable rather than
merely mentioned. The reasoning is in
[`02-device-page/09-restructure.md`](02-device-page/09-restructure.md).

## Layout

| Path | Contents |
|---|---|
| [`STATUS.md`](STATUS.md) | **Handoff** — verified vs unverified, how to debug against hardware, next steps |
| [`00-shared/`](00-shared/) | **What both surfaces share**, the build badge, and how the reconstructions are served in Orca |
| [`01-architecture/`](01-architecture/) | Layer model, bundle inventory, entry points and routes |
| [`02-device-page/`](02-device-page/) | **Surface 1** — screens, state machine, controls, reconstruction |
| [`03-print-processing/`](03-print-processing/) | **Surface 2** — lifecycle, filament mapping, reconstruction |
| [`04-bridge-wcp/`](04-bridge-wcp/) | The `window.wx` bridge: envelope, command catalogue, parameters |
| [`05-printer-protocol/`](05-printer-protocol/) | Moonraker-derived JSON-RPC, MQTT, state model, cloud API |
| [`06-errors/`](06-errors/) | The live 442-code catalogue, and the legacy 72-code asset |
| [`data/`](data/) | Machine-readable extraction output — every file is generated |
| [`reconstructed/`](reconstructed/) | Recovered Dart declarations, rendered as readable source |
| [`tools/`](tools/) | The extractors, the doc generators, and the screenshot harness |

## Headline findings

1. **The page owns the protocol, not Orca.** The bundle builds complete JSON-RPC
   envelopes — method names, parameter maps, subscription field filters — and hands
   them down. The C++ transports, authenticates and applies policy.
2. **The bridge success code is `200`, not `0`.** A response of `code: 0` is treated as
   a *failure* by the page. Confirmed three ways in
   [the envelope](04-bridge-wcp/01-envelope.md).
3. **The U1 runs Klipper**, behind a Moonraker-derived JSON-RPC 2.0 API with Snapmaker
   extensions (`printer.control.*`, `camera.*`, `custom.*`).
4. **Transport is MQTT 5 over mutual TLS**, topics namespaced by serial:
   `<SN>/request`, `/response`, `/status`, `/notification`.
5. **Two error tables ship.** The live one is 442 codes in 16 hex digits, carried in the
   i18n table; the 72-code `deviceError.json` asset is a Bambu-era leftover. Both are
   documented, and which is which matters.
6. **`?path=4` and `?path=5` resolve to swapped `AppModule` indices** — see
   [entry points](01-architecture/03-entry-points.md).
7. **Everything minified survives as string literals.** 274 enums, 1,370 enum values,
   163 class names — see [`reconstructed/enums.dart`](reconstructed/enums.dart).
8. **DevTools are unconditionally enabled** in shipping builds, so the live page can be
   inspected directly.

## Reproducing

Every file under `data/`, `reconstructed/`, and the generated markdown regenerates from
the bundle and the C++:

```bash
python3 docs/u1-webui/tools/run_all.py
```

Verify the reconstructions still match that evidence:

```bash
python3 resources/web/shared/tests/conformance_test.py
```

Screenshots of the shipped bundle come from the
[harness](tools/harness/README.md); screenshots of the reconstructions come from
serving `resources/web/` and loading either surface with `?mock=1`.

## Scope and confidence

This documents the **client side**: the bundle in this repo and the Orca C++ it talks
to. Printer-side behaviour is inferred from the client contract and from
[`MoonRaker.cpp`](../../src/slic3r/Utils/MoonRaker.cpp), not from firmware — anything not
directly observed is marked *inferred* where it appears.

Findings are drawn from four sources that cross-check each other: the compiled bundle,
the C++ host, live behaviour captured by the harness, and the reconstructions plus their
conformance tests. Where sources disagree, the disagreement is recorded rather than
resolved silently.
