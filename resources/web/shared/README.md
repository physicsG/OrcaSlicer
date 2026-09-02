# Shared layer

What the two reconstructed U1 surfaces have in common, factored out so it is written
once and guarded once.

| Module | Role |
|---|---|
| `js/sswcp.js` | The WCP bridge client — envelope, `seqid` correlation, subscriptions. Identical for both surfaces because both forward to the same `SSWCP::handle_web_message`. |
| `js/protocol.js` | Command names, the 24-object state model and its field filters, `print_task_config` field names, control limits, fault decoding. |
| `js/state.js` | The machine-state store: partial-push merging plus typed accessors (`toolheads()`, `taskConfig()`, `bed()`, `job()`). |
| `js/mockhost.js` | A simulated Orca host and U1. Each surface passes its own `handlers` for the commands only it needs. |
| `js/buildinfo.js` | Resolves and renders the build badge. |
| `css/base.css` | Design tokens and the badge. Surfaces layer their own stylesheet on top. |
| `tests/conformance_test.py` | Re-derives the constant tables from `docs/u1-webui/data/` and fails if the code has drifted. Guards **both** surfaces. |

Consumers:

- [`../device_page/`](../device_page/) — the Device tab (`?path=2`)
- [`../print_processing/`](../print_processing/) — the print popup (`?path=4` / `?path=5`)

## Two things worth knowing before you change anything here

**The bridge success code is `200`, not `0`.** `SSWCP.hpp` defaults `m_status = 200` and
the shipped bundle compares `payload.code` against the literal `200` in eleven places.
A client that accepts only `0` rejects every real response from Orca. `OK_CODE` and
`isOk()` in `sswcp.js` are the single definition; the conformance test pins them.

**`print_task_config` is read by one surface and written by the other.** The Device tab
labels its toolheads from it; the popup edits the filament mapping and the three
preference toggles in it. A change to that model touches both surfaces.

Full analysis: [what the two surfaces share](../../../docs/u1-webui/00-shared/01-shared-models.md).

## Verifying

```bash
python3 resources/web/shared/tests/conformance_test.py
```
