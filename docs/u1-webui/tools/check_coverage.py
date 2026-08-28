#!/usr/bin/env python3
"""Enumerate every bridge command and force each into a decision.

The reconstruction's gaps were found by a human noticing them, one at a time.
That does not scale and it is not trustworthy. This check inverts it: it derives
the full command surface from evidence, subtracts what the reconstruction
implements, and requires that everything left over is *explicitly* accounted for
with a written reason.

Anything neither implemented nor listed in EXCLUDED is reported as UNCLASSIFIED
and the check fails. A future bundle that adds a command therefore surfaces here
rather than in a bug report.

There are two questions here, and 07-parity.md answered only the first:

  1. Is the command implemented?  A `CMD.NAME` reference from client code.
  2. Can a user reach it?         A command module that some panel is handed.

The second is the one that matters and the one that was missing. A command can be
referenced by a handler that nothing calls - a panel with no button - and the first
question counts it as done. `sw_BedMesh_AbortProbeMesh` was exactly that.

The answer used to be a hand-written `sends` list in each panel, which made it a
promise: nothing stopped a panel claiming a command it never issued, and one did
(`DELETE_MACHINE_FILE`). It is now read out of the command module a panel is actually
handed - js/views/<destination>/<panel>/<panel>-commands.js - so the attribution is a
fact about the imports instead.

Two surfaces, because the page has two ways to ask the printer for something. The
bridge commands are the first; the ACE's G-code macros are the second, and the Filament
panel is built almost entirely out of them - so a macro deliberately not offered would
be invisible here rather than merely unbuilt. Both are held to the same rule.

Sources of truth:
  data/wcp-commands.json    which commands the bundle references and the host dispatches
  resources/web/**.js       which commands the reconstruction can issue
  device_page/js/views/    which panel can issue each one

Usage: check_coverage.py [--quiet]
Exit:  0 when every command is classified, 1 otherwise.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import DATA, ROOT  # noqa: E402

WEB = os.path.join(ROOT, "resources", "web")

# Commands deliberately not implemented, each with the reason. Keep the reason
# honest: "not built yet" is a fine reason; silence is not.
EXCLUDED = {
    # --- surfaces that are not the Device tab -----------------------------
    "sw_NewProject": "home/projects surface",
    "sw_OpenProject": "home/projects surface",
    "sw_GetRecentProjects": "home/projects surface",
    "sw_OpenRecentFile": "home/projects surface",
    "sw_DeleteRecentFiles": "home/projects surface",
    "sw_SubscribeRecentFiles": "home/projects surface",
    "sw_SwitchTab": "Orca shell navigation",
    "sw_SwitchModel": "Orca shell navigation",
    "sw_OpenBrowser": "Orca shell",
    "sw_OpenOrcaWebview": "Orca shell",
    "sw_OpenNetworkDialog": "Orca shell",
    "sw_LaunchConsole": "Orca shell",
    "sw_Exit": "Orca shell",
    "sw_GetActiveFile": "print-processing popup",
    "sw_GetPrintZip": "print-processing popup",
    "sw_GetPrintLegal": "print-processing popup",
    "sw_GetFileFilamentMapping": "print-processing popup",
    "sw_SetFilamentMappingComplete": "print-processing popup",
    "sw_FinishFilamentMapping": "print-processing popup",
    "sw_FinishPreprint": "print-processing popup",
    "sw_StartLocalPrint": "print-processing popup",
    "sw_StartCloudPrint": "print-processing popup",
    "sw_GetMachineFilamentMapping": "print-processing popup; no host handler either",
    "sw_UploadFiletoMachine": "print-processing popup",
    "sw_PullCloudFile": "cloud file transfer, print-processing popup",
    "sw_CancelPullCloudFile": "cloud file transfer, print-processing popup",
    "sw_GetFileStream": "cloud file transfer",
    "sw_UploadFile": "cloud file transfer; no host handler either",
    "sw_UploadFileResult": "cloud file transfer; no host handler either",

    # --- account: Orca owns the session, the page only reads it -----------
    "sw_UserLogin": "account surface; the Device tab only reads login state",
    "sw_UserLogout": "account surface",
    "sw_SubscribeUserLoginState": "read once at boot instead; no live re-auth UI",
    "sw_GetUserUpdatePrivacy": "privacy-consent surface",
    "sw_SubUserUpdatePrivacy": "privacy-consent surface",
    "sw_ServerClientManagerSetUserinfo": "cloud identity handshake, not exercised",

    # --- app plumbing the reconstruction does not need --------------------
    "sw_Log": "host-side logging; the page keeps its own WCP trace",
    "sw_SetLogLevel": "host-side logging",
    "sw_UploadEvent": "telemetry",
"sw_SetCache": "Orca-side cache the shipped page uses for its device list",
    "sw_GetCache": "Orca-side cache",
    "sw_RemoveCache": "Orca-side cache",
    "sw_SubscribeCacheKey": "Orca-side cache",
    "sw_UnsubscribeCacheKeys": "Orca-side cache",
    "sw_SubscribePageStateChange": "page visibility; no behaviour depends on it here",
    "sw_UnsubscribePageStateChange": "page visibility",
    "sw_Webview_Unsubscribe": "teardown; the page is not torn down mid-session",
    "sw_UnsubscribeAll": "teardown",
    "sw_Unsubscribe_Filter": "teardown",
    "sw_StopMachineStateSubscription": "teardown",
    "sw_UnSubscribeMachineState": "teardown; no host handler either",
    "sw_SendCommand": "no host handler",
    "sw_FileView": "opens a host file viewer",
    "sw_DownLoadFile": "timelapse download, handled by Orca's own popup",
    "sw_DownLoadFileAndOpen": "timelapse download",
    "sw_SubscribeDownloadState": "timelapse download",
    "sw_UnsubscribeDownloadState": "timelapse download",
    "sw_CancelDownload": "timelapse download",
    "sw_GetFilesFromDir": "timelapse download",
    "sw_OpenTimelapseFolder": "opens a host folder",
    "sw_NotifyUploadTimelaspe": "timelapse upload",
    "sw_UploadCameraTimelapse": "timelapse upload",
    "sw_UploadAsyncTimelapseInstance": "timelapse upload",

    # --- device discovery -------------------------------------------------
    "sw_WakeupFind": "NOT BUILT: network discovery",
    "sw_GetMachineFindSupportInfo": "NOT BUILT: network discovery",
    "sw_Connect": "empty stub in the host; connection goes through the mqtt agent",
    "sw_Disconnect": "the page disconnects its own engine via sw_mqtt_disconnect",
    "sw_GetPincode": "superseded: the LAN auth code is fixed, so no PIN is needed;\n                      kept in the protocol table for a first-time bind",
    "sw_Test_connect": "diagnostic",
    "sw_test_mqtt_moonraker": "diagnostic",
    "sw_mqtt_unsubscribe": "see sw_mqtt_subscribe",
    "sw_mqtt_unpublish": "see sw_mqtt_publish",

    # --- Device tab features genuinely not built yet ----------------------
    "sw_DefectDetactionConfig": "NOT BUILT: defect-detection settings UI",
    "sw_BedMesh_AbortProbeMesh":
        "NOT BUILT: nothing reports a bed mesh in progress. `bed_mesh` is not in\n"
        "                      SUBSCRIBE_OBJECTS and no activity label mentions probing, so\n"
        "                      an abort button would have no state to appear with. There was\n"
        "                      a handler for it, reached by nothing, which is what the\n"
        "                      reachability half of this check now catches.",
}


def implemented():
    """Commands the CLIENT actually issues.

    Not "appears as a string somewhere": protocol.js holds the whole CMD table
    and mockhost.js implements the *host* side, so counting bare literals
    massively over-reports. The real measure is a `CMD.NAME` reference from code
    that runs in the page.
    """
    proto = open(os.path.join(WEB, "shared", "js", "protocol.js"), encoding="utf-8").read()
    table = dict(re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*:\s*'(sw_[A-Za-z0-9_]+)'",
                            proto, re.M))

    client = ""
    for path in (
        os.path.join(WEB, "device_page", "js"),
        os.path.join(WEB, "shared", "js"),
    ):
        # Walk, not listdir: the commands and the panels live in subdirectories, and a
        # listdir here silently reported 17 implemented commands where there are 55.
        for root, _dirs, fs in os.walk(path):
            for f in sorted(fs):
                # mock.js / mockhost.js are the simulated HOST, not the client;
                # protocol.js is the table itself.
                if not f.endswith(".js") or f in ("mock.js", "mockhost.js", "protocol.js"):
                    continue
                client += open(os.path.join(root, f), encoding="utf-8").read()

    used = {table[n] for n in re.findall(r"\bCMD\.([A-Z][A-Z0-9_]*)", client) if n in table}
    # a couple of call sites still use the literal directly
    used |= set(re.findall(r"'(sw_[A-Za-z0-9_]+)'", client))
    return used


# Commands with no command module, because they are not a control: the session brings
# itself up, and a couple are answered by the page itself. Same discipline as EXCLUDED -
# a written reason, not silence.
#
# This list halved when the handlers were split per panel. Fifteen of its entries said
# "rail device menu", which was true and hand-written; commands/device.js now says the
# same thing by being the module that menu is handed.
OWNED_ELSEWHERE = {
    "sw_GetSoftwareInfo": "build badge",
    "sw_FileLog": "diagnostics beacon (?diag=1)",
    "sw_GetUserLoginState": "boot: who is signed in",
    "sw_SubscribeLocalDevices": "the rail's device list",
    "sw_create_mqtt_client": "connect path (connection.js)",
    "sw_mqtt_connect": "connect path",
    "sw_mqtt_disconnect": "connect path",
    "sw_mqtt_subscribe": "connect path",
    "sw_mqtt_publish": "connect path",
    "sw_mqtt_set_engine": "connect path",
    "sw_SetSubscribeFilter": "state stream",
    "sw_SubscribeMachineState": "state stream",
    "sw_GetMachineState": "state stream + the toolchange wait's polling",
    "sw_MachineHeartbeat": "session supervisor",
}


def owned_by_panels():
    """Which panel can issue each command, from the module that panel is handed.

    Not a declaration: js/views/<destination>/<panel>/<panel>-commands.js IS that
    panel's command set, so a command appears here exactly when code a user can reach
    issues it. page-commands.js is shared by every panel and widgets/rail-commands.js
    belongs to the rail's menu rather than to a panel, so both are named rather than
    attributed to one.
    """
    js = os.path.join(WEB, "device_page", "js")
    proto = open(os.path.join(WEB, "shared", "js", "protocol.js"), encoding="utf-8").read()
    table = dict(re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*:\s*'(sw_[A-Za-z0-9_]+)'",
                            proto, re.M))

    files = [(os.path.join(js, "page-commands.js"), "page"),
             (os.path.join(js, "widgets", "rail-commands.js"), "device")]
    for root, _dirs, fs in os.walk(os.path.join(js, "views")):
        for f in sorted(fs):
            if f.endswith("-commands.js"):
                files.append((os.path.join(root, f), f[:-len("-commands.js")]))

    owner = {}
    for path, panel in files:
        src = re.sub(r"//[^\n]*|/\*.*?\*/", "",
                     open(path, encoding="utf-8").read(), flags=re.S)
        for name in re.findall(r"\bCMD\.([A-Z][A-Z0-9_]*)", src):
            if name in table:
                owner.setdefault(table[name], []).append(panel)
    return owner


# ---------------------------------------------------------------------------
# The second surface: the ACE's G-code macros.
#
# The Filament panel's controls are not bridge commands at all - every one of them is a
# plain macro over sw_SendGCodes - so the accounting above cannot see them, and a macro
# that is deliberately not offered would be invisible rather than merely unbuilt. This
# is the same discipline applied to that surface: every entry either issued by a command
# module or excluded with a written reason, and cross-checked for existence against
# data/ace-macros.json - which tools/ace_macros.py reads off a real printer, because
# writing this table down is how it came to name an argument the machine ignores.
#
# The dangerous ones are the [EXPERIMENTAL] block. Their own help carries preconditions -
# "requires head mode, 1:1 wiring, an OPEN dock below the head (purges ~60 mm!)" - and a
# panel that offers them without enforcing those is a panel that purges filament onto a
# bed.
ACE_MACROS = {
    "SET_ACE_MODE": None,
    "ACE_SET_HEAD_FEEDER": None,
    "ACE_SET_HEAD_ACE": None,
    "ACE_SET_HEAD_MANUAL": None,
    "ACE_LOAD_HEAD": None,
    "ACE_UNLOAD_HEAD": None,
    "ACE_SWAP_HEAD": None,
    "ACE_UNLOAD_ALL_HEADS": None,
    "ACE_DRY": None,
    "ACE_STOP_DRYING": None,
    "ACE_SET_AUTO_DRY": None,

    "ACED__DRY_STOP":
        "NOT BUILT  its own help says it stops \"the current ACE\" - on a machine with "
        "two units that is whichever one is active, not the one whose chip was pressed. "
        "ACE_STOP_DRYING takes ACE=n and is what the panel sends.",
    "ACE_SET_PURGE": None,
    "ACE_SET_CONFIRM_COMMANDS": None,
    "ACE_SET_SPOOLMAN": None,
    "ACE_CLEAR_HEADS": None,

    "ACE_UNLOAD_ALL_CANCEL":
        "NOT BUILT  the reason it had - that nothing on screen waits for an unload, so "
        "there is no moment at which a cancel is the obvious thing to press - expired "
        "when the blocking dialog arrived. It now has a home and no evidence: what the "
        "macro does to a head mid-retract has never been measured, and a cancel that "
        "leaves filament somewhere unnamed is worse than finishing.",
    "ACE_SWITCH":
        "NOT BUILT  switches the ACTIVE unit, which only matters in multi mode. The "
        "panel is head-major: every card names its own unit, so there is no such thing "
        "as the active one on it.",
    "ACE_CALIBRATION_START":
        "not in v1  bowden calibration is a guided physical procedure - feed, mark, "
        "return - and a panel that starts it without walking someone through it is worse "
        "than no button.",
    # Offered now, and the reason they were withheld is the reason they are gated rather
    # than simply present: the preconditions are real and the panel does not guess at
    # them. `ace_bg_swap.enabled_heads` is what ACE_BG_SET_HEAD writes, it is read in the
    # same sw_GetMachineState call as `ace`, and a head that is not in it gets the verb
    # drawn UNAVAILABLE with that macro named as what would lift it. On the measured
    # machine the list is empty, so that refusal is the state the panel opens in.
    "ACE_BG_SWAP": None,
    "ACE_BG_UNLOAD": None,
    "ACE_BG_SET_HEAD": None,
    "ACE_BG_MOVE":
        "[EXPERIMENTAL]  the same preconditions, and nothing on the panel needs a bare "
        "move: the two verbs above are what a person asks for, and this is what they are "
        "built out of.",
}


def macros_used():
    """Which macros a command module can actually send.

    Read the same way the bridge commands are: through the `ACE` table in protocol.js,
    from the module a panel is handed. Referencing one IS the claim.
    """
    # shared/js/multiACE.js is the one module the whole subsystem lives in - macros,
    # constants, the state model and the override merge - so it is where the table is.
    mod = open(os.path.join(WEB, "shared", "js", "multiACE.js"), encoding="utf-8").read()
    block = re.search(r"export const ACE = \{(.*?)\n\};", mod, re.S)
    table = dict(re.findall(r"([A-Z][A-Z0-9_]*):\s*'([A-Za-z0-9_]+)'",
                            block.group(1) if block else ""))
    src = ""
    js = os.path.join(WEB, "device_page", "js")
    for root, _dirs, fs in os.walk(js):
        for f in sorted(fs):
            if f.endswith("-commands.js"):
                # Comments stripped first, or the sentence explaining why ACE_BG_UNLOAD
                # is withheld counts as a control that sends it. It did.
                src += re.sub(r"//[^\n]*|/\*.*?\*/", "",
                              open(os.path.join(root, f), encoding="utf-8").read(),
                              flags=re.S)
    used = {table[n] for n in re.findall(r"\bACE\.([A-Z][A-Z0-9_]*)", src) if n in table}
    used |= {m for m in re.findall(r"\b(ACE[A-Z]*_[A-Z0-9_]+)\b", src) if m in ACE_MACROS}
    return used


def machine_macros():
    """What the printer actually has, from data/ace-macros.json.

    Written down is how this table came to name `ACE_SET_AUTO_DRY THRESHOLD=`, an
    argument the printer accepts, answers `ok` to, and ignores. Existence is the half
    that CAN be checked from here, so it is - see tools/ace_macros.py for where the file
    comes from. Absent file means the cross-check is skipped rather than failed: not
    everyone has a printer with multiACE on it.
    """
    path = os.path.join(DATA, "ace-macros.json")
    if not os.path.exists(path):
        return None
    return set(json.load(open(path, encoding="utf-8")).get("macros") or {})


def check_macros(quiet):
    used = macros_used()
    have = machine_macros()
    offered = sorted(m for m in ACE_MACROS if m in used)
    withheld = sorted(m for m in ACE_MACROS if m not in used and ACE_MACROS[m])
    silent = sorted(m for m in ACE_MACROS if m not in used and not ACE_MACROS[m])
    unknown = sorted(used - set(ACE_MACROS))

    if not quiet:
        print(f"\nACE macro surface (classified here): {len(ACE_MACROS)}")
        print(f"  offered by the Filament panel     : {len(offered)}")
        print(f"  withheld, with reason             : {len(withheld)}")
        print(f"  UNACCOUNTED                       : {len(silent) + len(unknown)}")
        for m in withheld:
            print(f"  {m:26} {ACE_MACROS[m]}")
    ghosts = sorted(set(ACE_MACROS) - have) if have is not None else []
    if not quiet and have is not None:
        print(f"  cross-checked against {len(have)} on the machine")
    if silent:
        print("\nUNACCOUNTED - no control sends it and no reason is written down:")
        for m in silent:
            print(f"  {m}")
    if unknown:
        print("\nUNLISTED - a command module sends a macro this table does not name:")
        for m in unknown:
            print(f"  {m}")
    if ghosts:
        print("\nNOT ON THE MACHINE - this table names a macro printer.gcode.help does")
        print("  not have. Either the firmware dropped it or the name was written down")
        print("  wrong; re-run tools/ace_macros.py and fix the table:")
        for m in ghosts:
            print(f"  {m}")
    return 1 if (silent or unknown or ghosts) else 0


def main():
    quiet = "--quiet" in sys.argv
    cmds = json.load(open(os.path.join(DATA, "wcp-commands.json"), encoding="utf-8"))

    # The surface worth accounting for: the host dispatches it AND the shipped
    # bundle references it. A command only one side knows is a version-skew
    # artefact, reported separately by extract_wcp_commands.py.
    surface = sorted(k for k, v in cmds.items()
                     if v["implemented_in_cpp"] and v["referenced_in_bundle"])

    have = implemented()
    done = [c for c in surface if c in have]
    excluded = [c for c in surface if c not in have and c in EXCLUDED]
    unclassified = [c for c in surface if c not in have and c not in EXCLUDED]
    stale = sorted(set(EXCLUDED) & set(have))

    if not quiet:
        print(f"command surface (host dispatches + bundle references): {len(surface)}")
        print(f"  implemented in the reconstruction : {len(done)}")
        print(f"  explicitly excluded, with reason  : {len(excluded)}")
        print(f"  UNCLASSIFIED                      : {len(unclassified)}")
        notbuilt = sorted(c for c in excluded if EXCLUDED[c].startswith("NOT BUILT"))
        if notbuilt:
            print(f"\nnot built yet ({len(notbuilt)}):")
            for c in notbuilt:
                print(f"  {c:38} {EXCLUDED[c][10:]}")
    # --- can a user actually reach it? ------------------------------------
    owner = owned_by_panels()
    claimed = set(owner)
    unreachable = [c for c in done if c not in claimed and c not in OWNED_ELSEWHERE]
    # `phantom` is gone with the declaration it checked: a command module cannot claim
    # a command it does not reference, because referencing it IS the claim.

    if not quiet:
        print("\nreachability - which panel can issue it")
        for panel in sorted(set(p for ps in owner.values() for p in ps)):
            cs = sorted(c for c, ps in owner.items() if panel in ps)
            print(f"  {panel:10} {len(cs):2}  {' '.join(c[3:] for c in cs)}")
        print(f"  {'elsewhere':10} {len([c for c in done if c in OWNED_ELSEWHERE]):2}"
              f"  session, connect path, state stream")

    if unreachable:
        print("\nUNREACHABLE - implemented, but no control on the page issues it.")
        print("  Move it into <panel>-commands.js for the panel that should offer it, or")
        print("  say where it lives in OWNED_ELSEWHERE:")
        for c in unreachable:
            print(f"  {c}")
    if unclassified:
        print(f"\nUNCLASSIFIED - implement it, or add it to EXCLUDED with a reason:")
        for c in unclassified:
            print(f"  {c}")
    if stale:
        print(f"\nstale exclusions - now implemented, remove from EXCLUDED:")
        for c in stale:
            print(f"  {c}")
    bad_macros = check_macros(quiet)
    return 1 if (unclassified or stale or unreachable or bad_macros) else 0


if __name__ == "__main__":
    sys.exit(main())
