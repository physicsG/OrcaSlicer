# Parity with the shipped Device tab

> **Superseded, and worth reading anyway.** This document reported the command surface
> complete on the strength of `CMD.NAME` appearing somewhere in the source. That proves a
> command is *mentioned* — not that a control exists to issue it, and a panel with no
> button counted every command it would have called. Seven user-visible faults were found
> on hardware against this "complete" page.
>
> `check_coverage.py` asks the reachability question too now, by reading the command
> module each panel is actually handed. See
> [09-restructure.md](09-restructure.md) and
> [08-function-gap-analysis.md](08-function-gap-analysis.md).


What the reconstruction covers, what it does not, and how that was measured rather
than estimated.

## Scoping the question

The bundle references **117** `sw_*` commands, but those span every surface it serves —
the home page, projects, login, the print popup. Counting the reconstruction against all
117 measures the wrong thing.

The Device tab's own surface is its four panels plus the rail. Scoped that way:

| Area | Commands | Wired |
|---|---|---|
| Rail — device list, pairing, connect | 11 | **11** |
| Camera panel | 3 | **3** |
| Control panel | 12 | **12** |
| Printing Task panel | 8 | **8** |
| Filament panel | 1 | **1** |
| | **35** | **35** |

## Feature by feature

| Feature | Original | Reconstruction |
|---|---|---|
| Four panels, responsive 2×2 grid | ✓ | ✓ — breakpoint and widths measured |
| Device selector, saved-printer list | ✓ | ✓ |
| Pair a new printer (PIN) | ✓ | ✓ |
| Connect / disconnect | ✓ | ✓ |
| Rename / forget a printer | ✓ | ✓ |
| Live camera view | ✓ | ✓ — frame fetched over HTTP, measured |
| Time-lapse list | ✓ | ✓ — listing only, no playback |
| Toolhead + bed temperatures | ✓ | ✓ |
| Chamber LED, fans, purifier | ✓ | ✓ |
| Tool / step selectors, jog, home | ✓ | ✓ — via G-code |
| Print Preferences | ✓ | ✓ |
| Job progress | ✓ | ✓ |
| Pause / resume / cancel | ✓ | ✓ |
| Machine file browser | ✓ | ✓ — list, print, delete |
| Start a print from a machine file | ✓ | ✓ |
| Filament slots, edit type/colour | ✓ | ✓ |
| Print speed override | ✓ | ✓ |
| Firmware / system info panel | ✓ | ✓ — read-only; no update flow |
| Bed-mesh abort | ✓ | ✓ — abort only, no calibration wizard |
| Defect-detection configuration | ✓ | ✓ |
| Time-lapse delete | ✓ | ✓ — delete only; playback is Orca's own window |
| File thumbnails, metadata, download | ✓ | ✓ |
| Machine storage usage | ✓ | ✓ |
| Fault banner, decoded against the 442-code catalogue | ✓ | ✓ |

Also added: network discovery, add-device, connect-another-machine, a liveness
heartbeat, Klipper object discovery, and file transfer status.

## What is left

**Nothing on the command surface.** Every command the host dispatches and the bundle
references is either implemented or excluded with a written reason, and the coverage
check fails the build otherwise.

Three honest qualifications remain:

1. **Some flows delegate to Orca.** `sw_AddDevice` and `sw_ConnectOtherMachine` open
   Orca's own native dialogs — that is what the commands *do*, so calling them is the
   complete implementation. Time-lapse playback is likewise Orca's own window.
2. **Depth, not breadth.** A firmware *update* flow and a calibration *wizard* are not
   built; the reconstruction reads system info and can abort a bed mesh, which is the
   whole of what the bridge exposes for them.
3. **Response shapes that needed hardware.** Camera frames, file thumbnails and
   discovery results are pass-throughs from the printer, and their field names are
   literals in neither the bundle nor the C++. Two of the three are now **measured**
   against a real U1 and the client rebuilt around what it found — the camera does not
   push frames at all, and the thumbnail command the page asked first returns paths
   rather than image bytes. See
   [05-printer-protocol/06-mqtt-topics.md](../05-printer-protocol/06-mqtt-topics.md),
   and `docs/u1-webui/data/hardware-shapes.json` for the capture the conformance suite
   now pins those constants to. Discovery is still open: `sw_StartMachineFind` is Orca's
   own Bonjour sweep rather than a pass-through, so it needs the running app.

## How coverage is enforced, not judged

The gaps above were originally found by a person noticing them. That does not scale and
should not be trusted, so it is now inverted:

```bash
python3 docs/u1-webui/tools/check_coverage.py
```

It enumerates every command the host dispatches **and** the shipped bundle references
(111 of them), subtracts what the reconstruction actually issues — measured by `CMD.*`
references from code that runs in the page, not by string literals, which would count the
constant table and the simulated host — and requires that **everything left over is
listed with a written reason**.

| | |
|---|---|
| Command surface | 111 |
| Implemented | 35 |
| Excluded, each with a reason | 76 |
| **Unclassified** | **0** |

Anything neither implemented nor excluded is reported as `UNCLASSIFIED` and fails the
build. A future bundle that adds a command surfaces here rather than in a bug report. The
check also flags *stale* exclusions — something listed as missing that has since been
implemented — which caught four wrong entries the first time it ran.

It runs as part of `run_all.py` and as a conformance check, and is negative-controlled:
removing a command from the client turns the suite red.

## How this is kept honest

- **31 conformance checks** re-derive the constant tables, the device record's field
  names, the success code, the control limits and the connection sequence from
  `docs/u1-webui/data/` and from `SSWCP.cpp` / `AppConfig.hpp` directly. Each has been
  negative-controlled.
- **28 browser checks** drive the real modules against the simulated printer.
- The parity table above is regenerated by scoping the command list, not by hand.

One caveat that applies to most of it: the simulator implements the contract as read from
the C++. That proves client and contract agree — it does not prove a real U1 agrees. The
camera and thumbnail findings are exactly where that gap turned out to be real, and both
are now closed by measurement rather than by reading; the eleven hardware checks in the
conformance suite hold them there. The WCP trace at the foot of the page remains how the
rest is debugged.

## A bug this work surfaced

`map_sswcp.py` built its dispatch map by matching `m_cmd == "sw_*"` literals, but 15
commands are dispatched through header macros (`GET_DEVICEDATA_STORAGESPACE`) and were
missing from `sswcp-commands.json` — which made `sw_GetDeviceDataStorageSpace` look
unimplemented when it has a handler at `SSWCP.cpp:3767`. The extractor now resolves the
macros, and the dispatch count went from 111 to **123**.

The conformance suite caught this, not a human reading.
