# 07 · Testing, Risks & Open Questions

## 7.1 Test strategy

### Unit (no hardware, no network) — highest value
- **Snapshot parser:** feed captured `/api/state` JSON (single ACE, multi ACE,
  empty slots, RFID vs derived, null colours) → assert `AceSnapshot`.
- **`apply_snapshot()` → `amsList`:** assert `Ams`/`AmsTray` fields,
  `ams_exist_bits`, `tray_exist_bits`, colour conversion (`#ff0000` →
  `FF0000FF`), pruning of removed units/slots, last-good retention on empty fetch.
- **Numbering:** assert that mapping a filament to ACE `a`/slot `s` yields
  `tray_index == a*4 + s` through `ams_filament_mapping()`.

Add under `tests/` (Catch2, per `AGENTS.md`). Store sample JSON under
`tests/data/`.

### Integration (mock server)
- Stand up a local FastAPI stub (or a static file server) that serves the
  documented endpoints, point the provider at `http://127.0.0.1:<port>` and
  verify the AMS tab/mapping popup populate. multiACE itself can be run off-printer
  (`uvicorn main:app --port 7126` with `MOONRAKER_URL` set) for realistic data.

### On-device (manual, documented in PR)
- 1 ACE, 2 ACE, and 3–4 ACE setups.
- RFID and non-RFID spools (verify `source` handling and manual override).
- Slice → post-process → print a 5–8 colour model; verify swaps land on the
  right heads and colours match the UI mapping.
- Dryer running / humidity display.
- Network drop mid-session (AMS must not blank out).

## 7.2 Edge cases to handle

| Case | Expected behaviour |
|------|--------------------|
| multiACE not installed / `/api/health` fails | Do not attach provider; U1 behaves as today (no AMS). No errors surfaced beyond a log line. |
| Transient fetch failure | Keep last-good `amsList`; retry with backoff; only clear on a definitive empty response. |
| Slot `source == "derived"` | Show but badge as "inferred"; note post-processor live-lookup ignores it. |
| Empty slot (`state=="empty"`/`raw==0`) | `AmsTray::is_exists=false`; clear `tray_exist_bits` bit. |
| `device_count` > units actually reporting | Trust `device_count` for how many `Ams` to show; mark missing as `is_exists=false` (mirrors multiACE 20 s startup lock). |
| `mode == "normal"` (ACE disabled) | Optionally hide ACE AMS or show disabled; don't map filaments to ACE while normal. |
| `mode == "head"` (per-head ACE) | Numbering still `ace*4+slot`, but slot→head wiring differs; verify mapping semantics with multiACE head mode before enabling. |
| null `color` | Default `FFFFFFFF`; don't crash colour decode. |
| ACE 2 Pro vs ACE Pro (`protocol` v2/v1) | Same schema; no special-casing needed at the slicer. |
| MQTT push also sends `ams` | Reconcile ownership (see [04 §4.7](04-provider-design.md)); do not double-write. |

## 7.3 Risks

- **Auth/TLS friction (Option B).** Reaching `/multiace/…` may require Moonraker
  auth and self-signed TLS trust. Mitigation: support plain-HTTP (the
  post-processor's default), reuse the U1's existing local-SSL trust, and
  document the Moonraker trusted-client setup. See
  [02 §2.7](02-multiace-printer-api.md).
- **Dependency on a beta community project.** multiACE is beta and evolving; its
  JSON could change. Mitigation: version-check via `/api/version`; defensive
  parsing (treat all fields optional, as multiACE's own code does); pin against a
  known `/api/state` schema and log unexpected shapes.
- **Two sources of truth for `amsList`.** MQTT vs provider. Mitigation: single
  writer, tag provider-owned units, guard against empty overwrites.
- **Live-lookup vs UI divergence.** If the slicer maps by project index but the
  post-processor re-matches by colour (`--live-lookup`), the printed assignment
  can differ from the UI. Mitigation: prefer design **A** (emit physical
  indices) so no re-matching is needed; if using **B**, surface the same
  `rfid/override`-only slot identities the post-processor trusts.
- **Threading.** `amsList` mutation off the GUI thread would race the UI.
  Mitigation: marshal all writes to the GUI thread (`CallAfter`/event), like
  `parse_json`.
- **Large gcode preflight on the printer.** The U1 is slow; the on-device
  preflight caps file size. Mitigation: recommend PC-side post-processing for big
  multi-colour prints (document in-app).

## 7.4 Open questions (resolve with a live U1 / maintainers)

1. **Transport for state:** does the U1's existing MQTT stream already carry (or
   can it carry) ACE state, enabling Option A with no HTTP? If yes, prefer it.
2. **Auth reality:** on a stock Snapmaker-firmware U1 with multiACE, is
   `http://<ip>/multiace/api/state` reachable without a token (as the
   post-processor assumes), or is Moonraker auth enforced?
3. **Send path:** how does Orca currently submit prints to the U1 (Moonraker
   upload)? Is filament mapping carried purely in gcode tool indices, or is there
   an AMS-mapping payload to fill too?
4. **Tool numbering on export:** does the U1 profile already emit `T<n>` per
   filament? Can we make the exporter emit physical `ace*4+slot` indices
   (design A) cleanly?
5. **Capability detection:** acceptable to probe `/api/health` on connect, or
   should a printer-profile flag gate it?
6. **Head mode:** should the first release support only `multi` mode (simplest,
   `ace*4+slot`), deferring `head` mode?
7. **Nozzle/extruder model:** the U1 is a 4-head tool-changer fed by ACE; confirm
   how `Ams::nozzle` / `Extder` should be set so multi-extruder logic behaves.

## 7.5 Definition of done (first release)

- Selecting an ACE-equipped U1 shows every connected ACE unit and its 4 slots in
  the AMS tab, with material, colour, RFID and humidity.
- The filament-mapping popup lets the user assign project filaments to
  `(ACE, slot)`.
- A sliced multi-colour project, after the documented post-processing step,
  prints with correct per-head swaps matching the UI mapping.
- No regression to the U1 experience when multiACE is absent.
- Unit tests cover snapshot parsing and `amsList` population.
