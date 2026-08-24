#!/usr/bin/env python3
"""Regenerate every artefact under ../data/ and ../reconstructed/.

    python3 docs/u1-webui/tools/run_all.py

Each step is independent; a failing step reports and the rest continue, so a
bundle update that breaks one extractor still refreshes the others.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import MAIN_JS, DATA, RECON  # noqa: E402

# (script, [args]) - scripts with no args write their own output paths.
I10N = os.path.join(os.path.dirname(MAIN_JS), "assets", "assets", "i10n")
REPO = os.path.abspath(os.path.join(os.path.dirname(HERE), "..", ".."))

STEPS = [
    # --- extractors: bundle/C++ -> data/ ---
    ("extract_routes.py", []),
    ("extract_enums.py", []),
    ("extract_wcp_commands.py", []),
    ("extract_errors.py", []),
    ("extract_rpc.py", [MAIN_JS, os.path.join(DATA, "jsonrpc-methods.json")]),
    ("extract_state_model.py", [MAIN_JS, os.path.join(DATA, "state-model.json")]),
    ("extract_dart_classes.py", [MAIN_JS, os.path.join(DATA, "dart-classes.json")]),
    ("extract_wire_enums.py", [MAIN_JS, os.path.join(DATA, "wire-enums.json")]),
    ("extract_error_catalog.py", [I10N, os.path.join(DATA, "error-catalog.json")]),
    ("extract_strings.py", [MAIN_JS, os.path.join(DATA, "bundle-strings.txt")]),
    # NB: this one writes to argv[-1] - without an explicit output path it
    # would take its own path as the destination and overwrite itself.
    ("map_sswcp.py", [REPO, os.path.join(DATA, "sswcp-commands.json")]),
    # --- generators: data/ -> markdown ---
    ("gen_command_catalogue.py", []),
    ("gen_command_reference.py", [REPO]),
    ("gen_legacy_error_doc.py", []),
    ("gen_jsonrpc_reference.py", []),
    ("extract_activity.py", []),
    ("gen_activity_module.py", []),
    ("gen_error_module.py", []),
    ("check_coverage.py", ["--quiet"]),
]


def main():
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(RECON, exist_ok=True)
    if not os.path.exists(MAIN_JS):
        sys.exit(f"bundle not found: {MAIN_JS}")

    failed = []
    for script, args in STEPS:
        print(f"\n=== {script} " + "=" * (58 - len(script)))
        r = subprocess.run([sys.executable, os.path.join(HERE, script)] + args)
        if r.returncode != 0:
            failed.append(script)

    print("\n" + "=" * 66)
    if failed:
        print("FAILED: " + ", ".join(failed))
        return 1
    print("all extractors succeeded")
    for d in (DATA, RECON):
        print(f"\n{os.path.relpath(d, os.path.dirname(HERE))}/")
        for n in sorted(os.listdir(d)):
            size = os.path.getsize(os.path.join(d, n))
            print(f"  {size:>9,}  {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
