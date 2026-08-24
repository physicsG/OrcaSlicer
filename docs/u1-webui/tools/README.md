# Extraction tools

Every file in [`../data/`](../data/) is produced by these scripts. They are plain Python 3
with no dependencies, and all read-only with respect to the bundle.

| Script | Produces | What it does |
|---|---|---|
| `extract_strings.py` | `strings.tsv` (scratch) | Pulls every JS string literal with an occurrence count. The substrate for everything else — dart2js minifies identifiers but not strings. |
| `extract_rpc.py` | `jsonrpc-methods.json` | Finds `{"jsonrpc":"2.0","method":…}` envelope constructions and reads the literal keys of the nested params map. |
| `extract_state_model.py` | `state-model.json` | Recovers the subscription object list and the per-object field filter. |
| `extract_dart_classes.py` | `dart-classes.json` | Recovers original Dart class and field names from `toString()` string literals, and wire keys from `toJson()`. |
| `extract_error_catalog.py` | `error-catalog.json` | Builds the 442-code U1 error catalogue from the i18n table and decodes the code structure. |
| `map_sswcp.py` | `sswcp-commands.json` | Maps `sw_*` commands to C++ handlers and their param/response keys. |
| `gen_command_reference.py` | `../02-bridge-sswcp/02-command-reference.md` | Renders the grouped command reference. |
| `run_all.py` | all of the above | Regenerates everything. |

## Hardware probes

The scripts above read the bundle. These three talk to a real printer, and answer the one
class of question static analysis cannot: what the firmware actually sends back. They need
a U1 on the LAN and no running Orca — the session leg authenticates with the saved
`clientId`, and a broker evicts the older holder of a duplicate id.

| Script | What it does |
|---|---|
| `mqtt_min.py` | MQTT 3.1.1 in ~200 lines of standard library — CONNECT, SUBSCRIBE, PUBLISH, PINGREQ, plain and mTLS. `paho-mqtt` is not installable here and this is all the protocol needs. |
| `u1_probe.py` | Runs the documented connect path and records real response shapes for the file listing, both thumbnail commands and the camera. |
| `u1_topics.py` | Subscribes the `#` wildcard on both legs so the broker enumerates its own topics, provoking traffic in labelled phases. Produces [`../05-printer-protocol/06-mqtt-topics.md`](../05-printer-protocol/06-mqtt-topics.md). |

```bash
python3 docs/u1-webui/tools/u1_probe.py  --out /tmp/shapes.json
python3 docs/u1-webui/tools/u1_topics.py --md /tmp/topics.md --json /tmp/topics.json
```

Both read the device out of Orca's config, or take `--ip` / `--sn` / `--client-id`.

They are **read-only**: every method they send queries, lists or subscribes, and none
moves the machine or touches a print job. Certificates live in a temporary file for the
life of the socket and are never written to a report.

Unlike the extractors, these are not part of `run_all.py` — they need hardware, so they
cannot run in a check. Their findings are written into the docs by hand, with the raw
capture quoted so a later run can be diffed against it.

## Regenerating

From the repo root:

```bash
python3 docs/u1-webui/tools/run_all.py
```

## Why this works

dart2js in release mode mangles identifiers but preserves:

1. **String literals** — so method names, wire keys, routes and asset paths survive intact.
2. **`toString()` bodies** — Dart's conventional `toString` embeds the class name and its
   field names as literals, which recovers the domain model that minification hid.
3. **Constant lists** — subscription lists and field filters are emitted as literal arrays.

The one thing that does *not* survive is control flow and identifier names, so behavioural
claims here are cross-checked against Orca's own C++ (`SSWCP.cpp`, `MoonRaker.cpp`) rather
than inferred from the bundle alone.

## Version sensitivity

Minified symbol names (`A.bM`, `bJ3`, …) change on every rebuild. The scripts therefore
anchor on **string literals and structural patterns**, never on a symbol name, with one
exception noted in `extract_state_model.py`. Re-running against a newer bundle should work;
if a script returns zero rows, its anchor pattern is what needs updating.

Bundle these were written against: **orca 2.3.26, build 20260813142841**.
