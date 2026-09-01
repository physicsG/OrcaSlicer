#!/usr/bin/env python3
"""Recover Dart enum declarations from the dart2js constant pool.

dart2js lowers a Dart enum value to a constant-pool entry of the shape

    B.<constName> = new A.<typeSymbol>(<index>, "<valueName>")

The *type* is minified to `A.<typeSymbol>`, but the value's `index` and `name`
survive verbatim because Dart's `EnumName.name` needs them at runtime. Grouping
every constant by its type symbol therefore reconstructs the whole enum, in
declaration order, without any guesswork.

Where the type also carries the conventional `toString` override

    A.<sym>.prototype={ G(){return"<TypeName>."+this.b} }

the real Dart type name is recovered too, so the output is a genuine
`enum TypeName { ... }` rather than an anonymous group.

Writes: data/dart-enums.json  and  reconstructed/enums.dart
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import read_bundle, DATA, RECON  # noqa: E402

# Framework/runtime enums we do not care about. Anything matching is still
# extracted, just filed under "framework" instead of "app".
FRAMEWORK_HINTS = (
    "ui.", "dart.", "Axis", "Brightness", "BlendMode", "TextAlign", "Clip",
    "Overflow", "Semantics", "Scroll", "Keyboard", "Pointer", "Painting",
    "Rendering", "Material", "Cupertino", "Sentry", "Line", "Word", "Grapheme",
)


def value_name_sort(vals):
    return sorted(vals.items())


def main():
    d = read_bundle()

    # 1. type symbol -> {index: name}
    enums = {}
    pat = re.compile(r'B\.(\w+)\s*=\s*new A\.(\w+)\((\d+),"([A-Za-z_]\w*)"\)')
    consts = {}
    for m in pat.finditer(d):
        const, sym, idx, name = m.groups()
        enums.setdefault(sym, {})[int(idx)] = name
        consts.setdefault(sym, {})[int(idx)] = const

    # 2. type symbol -> real Dart type name, from the toString override.
    #    G(){return"TypeName."+this.b}
    names = {}
    for m in re.finditer(r'A\.(\w+)\.prototype=\{\s*\n?G\(\)\{return"([\w$]+)\."\+this\.b\}', d):
        names[m.group(1)] = m.group(2)

    # A few framework enums (BlendMode, StrokeCap, ...) are emitted twice, once
    # for dart:ui and once for the framework re-export. Disambiguate by symbol
    # so neither copy is silently dropped.
    label_counts = {}
    for sym, vals in enums.items():
        if len(vals) >= 2:
            n = names.get(sym) or f"Anon_{sym}"
            label_counts[n] = label_counts.get(n, 0) + 1

    def is_bitfield(vals):
        """Flag sets (SemanticsFlag, SemanticsAction) lower to the same constant
        shape as an ordinal enum, but their 'index' is a bit mask, not a position.
        Powers of two with no zero is the giveaway. Treating them as ordinal would
        make `gaps` span the whole mask range, which is meaningless and enormous."""
        ks = sorted(vals)
        return len(ks) >= 3 and all(k > 0 and (k & (k - 1)) == 0 for k in ks)

    out = {}
    for sym, vals in enums.items():
        if len(vals) < 2:
            continue  # a single constant is not evidence of an enum
        tname = names.get(sym)
        label = tname or f"Anon_{sym}"
        if label_counts.get(label, 0) > 1:
            label = f"{label}#{sym}"
        framework = tname is not None and any(h in tname for h in FRAMEWORK_HINTS)
        bits = is_bitfield(vals)
        out[label] = {
            "dart_name": tname,
            "symbol": sym,
            "resolved": tname is not None,
            "count": len(vals),
            "shape": "bitfield" if bits else "ordinal",
            "declared_max_index": max(vals),
            "values": [
                {"index": i, "name": n, "const": consts[sym][i]}
                for i, n in value_name_sort(vals)
            ],
            # Ordinal enums only: an index with no constant in the pool. The slot
            # is real (the enum declares it) but its name was never referenced,
            # so it cannot be recovered. Meaningless for a bitfield.
            "gaps": [] if bits else [i for i in range(max(vals) + 1) if i not in vals],
            "kind": "framework" if framework else "app",
        }

    os.makedirs(DATA, exist_ok=True)
    os.makedirs(RECON, exist_ok=True)
    with open(os.path.join(DATA, "dart-enums.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)

    # 3. Render the resolved ones as readable Dart.
    lines = [
        "// Recovered from resources/web/flutter_web/main.dart.js by tools/extract_enums.py",
        "// Values and indices are verbatim from the dart2js constant pool.",
        "// A `gap` comment marks an index whose constant was never referenced,",
        "// so its name could not be recovered - the slot itself is real.",
        "",
    ]
    resolved = {k: v for k, v in out.items() if v["resolved"]}
    for label in sorted(resolved):
        e = resolved[label]
        lines.append(f"/// minified: A.{e['symbol']}   ({e['count']} values)")
        if e["shape"] == "bitfield":
            lines.append(f"abstract class {e['dart_name']} {{  // bit flags, not an enum")
            for v in e["values"]:
                lines.append(f"  static const int {v['name']} = 0x{v['index']:X};")
            lines.append("}")
            lines.append("")
            continue
        lines.append(f"enum {e['dart_name']} {{")
        prev = -1
        for v in e["values"]:
            if v["index"] != prev + 1:
                miss = ", ".join(str(i) for i in range(prev + 1, v["index"]))
                lines.append(f"  // gap: index {miss} not in constant pool")
            lines.append(f"  {v['name']},  // {v['index']}")
            prev = v["index"]
        lines.append("}")
        lines.append("")
    with open(os.path.join(RECON, "enums.dart"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    app = [k for k, v in out.items() if v["kind"] == "app"]
    bitf = [k for k, v in out.items() if v["shape"] == "bitfield"]
    print(f"enums recovered      : {len(out)}")
    print(f"  with real Dart name: {len(resolved)}")
    print(f"  app (non-framework): {len(app)}")
    print(f"  bitfield (not enums): {len(bitf)}")
    print(f"total enum values    : {sum(v['count'] for v in out.values())}")


if __name__ == "__main__":
    main()
