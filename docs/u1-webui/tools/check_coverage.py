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

Sources of truth:
  data/wcp-commands.json   which commands the bundle references and the host dispatches
  resources/web/**.js      which commands the reconstruction can issue

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
        for f in sorted(os.listdir(path)):
            # mock.js / mockhost.js are the simulated HOST, not the client;
            # protocol.js is the table itself.
            if not f.endswith(".js") or f in ("mock.js", "mockhost.js", "protocol.js"):
                continue
            client += open(os.path.join(path, f), encoding="utf-8").read()

    used = {table[n] for n in re.findall(r"\bCMD\.([A-Z][A-Z0-9_]*)", client) if n in table}
    # a couple of call sites still use the literal directly
    used |= set(re.findall(r"'(sw_[A-Za-z0-9_]+)'", client))
    return used


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
    if unclassified:
        print(f"\nUNCLASSIFIED - implement it, or add it to EXCLUDED with a reason:")
        for c in unclassified:
            print(f"  {c}")
    if stale:
        print(f"\nstale exclusions - now implemented, remove from EXCLUDED:")
        for c in stale:
            print(f"  {c}")
    return 1 if (unclassified or stale) else 0


if __name__ == "__main__":
    sys.exit(main())
