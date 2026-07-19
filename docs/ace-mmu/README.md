# ACE Multi-Material Source Provider for Snapmaker Orca

> Integration design docs for exposing one or more Anycubic **ACE Pro / ACE 2 Pro**
> filament changers on the **Snapmaker U1** through Snapmaker Orca's existing
> AMS-oriented machine model, so that slicing/filament-mapping works the same way
> BambuStudio and Anycubic Slicer Next already expose multi-material systems.
>
> Target branch: `feat/add-ace-mmu-support`

## What this is

The Snapmaker U1 has no first-party AMS. The community project
[multiACE](https://github.com/decay71/multiACE) adds multi-ACE support **on the
printer** (Klipper/Moonraker + a small FastAPI service). It already knows, at any
moment, which ACE units are connected and what filament sits in each slot
(type, colour, brand, RFID, humidity, dryer, load/feed state).

This documentation describes how to build a **Multi-Material Source Provider**
inside Snapmaker Orca that:

1. **Reads** ACE inventory + live state from the printer-side multiACE service
   over the network (REST + WebSocket, or Moonraker directly).
2. **Maps** every connected ACE unit → an `Ams`, and every slot → an `AmsTray`,
   populating `MachineObject::amsList` — the same structures BambuStudio's AMS,
   Anycubic Slicer Next, and the existing Orca device UI already consume.
3. **Feeds** the existing filament-mapping / AMS-mapping pipeline so the slicer
   assigns each project filament to a physical `(ACE, slot)` and emits the
   correct virtual tool indices that multiACE's post-processor expects.

## The key insight (why this is tractable)

Orca's AMS model already numbers trays as:

```
tray_index = ams_id * 4 + tray_id          // MachineObject::ams_filament_mapping
```

multiACE's post-processor numbers virtual tool heads as:

```
ACE  = T // 4 ;  SLOT = T % 4 ;  HEAD = T % 4    // post_process_virtual_toolheads.py
```

These are **the same numbering**. If we expose **ACE `k` as `Ams(id="k")`** and
**slot `s` as `AmsTray(id="s")`**, the *unmodified* Orca AMS mapping produces
exactly the `T = ace*4 + slot` indices multiACE consumes. No changes to the
mapping algorithm or gcode T-numbering are required — only a data provider.

## Document index

| # | Document | Contents |
|---|----------|----------|
| 1 | [01-architecture.md](01-architecture.md) | End-to-end architecture, data flow, how Anycubic Slicer Next & BambuStudio solve the same problem, options analysis |
| 2 | [02-multiace-printer-api.md](02-multiace-printer-api.md) | Verified reference of the multiACE printer-side interface: REST, WebSocket, Moonraker objects, JSON schema, gcode commands |
| 3 | [03-orca-ams-data-model.md](03-orca-ams-data-model.md) | The existing Orca `Ams` / `AmsTray` / `amsList` model and how the U1 connects |
| 4 | [04-provider-design.md](04-provider-design.md) | Proposed `AceMmuProvider` component: classes, threading, field mapping table |
| 5 | [05-implementation-plan.md](05-implementation-plan.md) | Phased, file-by-file implementation plan with concrete touch points |
| 6 | [06-slicing-gcode-mapping.md](06-slicing-gcode-mapping.md) | Filament→slot mapping, virtual tool indices, gcode/post-processing, send-to-printer |
| 7 | [07-testing-risks-open-questions.md](07-testing-risks-open-questions.md) | Test strategy, edge cases, risks, and questions to resolve before/while coding |

### For implementers / agents

| File | Contents |
|------|----------|
| [AGENT.md](AGENT.md) | **Start here to implement.** Agent playbook: what to work on, where info is, workflow, guardrails, how to store progress |
| [PROGRESS.md](PROGRESS.md) | Durable, append-only progress log (current phase, decisions, blockers, session log) |

## Status

These are **design + research documents**, produced from a deep read of:

- The Snapmaker Orca codebase (`src/slic3r/GUI/DeviceManager.*`, `Utils/MoonRaker.*`,
  AMS GUI widgets).
- The multiACE repository source (`multiace/web/backend/main.py`,
  `multiace/tools/post_process_virtual_toolheads.py`, `config/extended/ace.cfg`,
  `multiace/web/deploy/*`).
- Anycubic Slicer Next (`ANYCUBIC-3D/AnycubicSlicerNext`) — confirmed to reuse the
  stock BambuStudio AMS model unchanged.

No production code has been written yet; this set defines *what* to build and *how*.
