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
