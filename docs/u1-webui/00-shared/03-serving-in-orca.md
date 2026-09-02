# Serving the reconstructions in Orca

Orca loads the reconstructed Device tab and print-processing popup instead of the shipped
Flutter bundle. This page covers the wiring, what still has a switch and what does not,
and what the bundle is still there for.

## The Device tab has one implementation

**`?path=2` is not loaded by anything any more.** The tab is
`/web/device_page/index.html`, unconditionally, and `PrinterWebView` no longer carries the
Original / Rebuilt switcher it had while the two were being compared.

That is a decision about ownership rather than about preference. The shipped Device page
was doing one thing for Orca that no other surface does — telling it what filament is in
the machine, which is what the sidebar's filament combo boxes are built from — and while
both pages existed it was possible to have that work by accident, because someone had the
other one open. The reconstruction does it itself now
([12-orca-integration.md](../02-device-page/12-orca-integration.md)), and with that done a
switch back is a switch to a page that would fight it for the same state: two Device pages
mean two MQTT sessions to one printer and two writers of one record.

```cpp
// GUI_App.cpp
case U1Surface::DeviceTab:
    path = "/web/device_page/index.html";
    break;
```

`is_u1_device_tab_url()` matches that URL and only that URL. It deliberately no longer
accepts `flutter_web…path=2`: nothing loads it, and treating it as the Device tab would
register a second page for state pushes only one document can own.

## The popup still has both

One config key, still read in the same one function:

| `u1_reconstructed_ui` | Print popup |
|---|---|
| `true` *(default)* | `/web/print_processing/index.html?mode=print` \| `?mode=upload` |
| `false` | `/web/flutter_web/index.html?path=4` \| `…?path=5` |

Flip it in Orca's config file — `Snapmaker_Orca.conf` in the data directory — and
restart. No rebuild needed. The key no longer affects the Device tab.

## What changed in the C++

Five sites built the Device-tab URL by hand and two built the popup's. All seven now go
through `get_u1_surface_url()`:

| File | Was |
|---|---|
| `PrinterWebView.cpp` | `…?path=2` |
| `Plater.cpp` | `…?path=2` |
| `GUI_App.cpp` | `…?path=2` |
| `SSWCP.cpp` (×2) | `…?path=2` |
| `WebPreprintDialog.cpp` (×2) | `…?path=4`, `…?path=5` |

Two places also *tested* those URLs, and a bare swap would have silently broken them:

```cpp
// PrinterWebView::load_url - decides whether to register the printer view
if (url.find("path=2") != std::string::npos)   ->   if (GUI_App::is_u1_device_tab_url(url))

// PrinterWebView::isSnapmakerPage
return url.find("flutter_web") != npos          ->   return GUI_App::is_u1_surface_url(url)
```

Both helpers accept either implementation, so callers never need to know which is
active.

Untouched, because they are different surfaces we did not reconstruct: `?path=0`
(`WebViewDialog`), `?path=3` (`deviceControlOld`), `?path=discovery`
(`WebDeviceDialog`). See "The bundle is still shipped" below.

## Why the URLs resolve

`HttpServer` picks the root by whether the URL mentions `flutter_web`:

```cpp
if (trimmed_url.find("flutter_web") == std::string::npos)
     res = resources_dir() + trimmed_url;   // the reconstructions
else res = data_dir()      + trimmed_url;   // the shipped bundle, copied on first run
```

So `/web/device_page/…` and `/web/shared/…` come from `resources/`, where they live, and
`../flutter_web/version.json` still comes from the data directory. No server change was
needed.

Two details that make it work: query strings are stripped before path resolution (so
`?mode=print` is harmless), and `.js` is served as `text/javascript` — without which ES
modules would refuse to execute.

`resources/` is installed wholesale (`install(DIRECTORY "${SLIC3R_RESOURCES_DIR}/" …)`)
and symlinked into the build tree during development, so the new directories are picked
up with no CMake change.

## The bundle is still shipped, and still used

Retiring the Device page does not retire `flutter_web`. It is one monolithic
`main.dart.js` with a `?path=` dispatcher, so there is no such thing as removing one
route, and three surfaces still load it:

| | |
|---|---|
| `?path=0` → `home` | the **Home tab** (`WebViewDialog`). This is where the account lives: the Sign-in control is here, and it is the only caller of `sw_UserLogin` besides the two dialogs below and the Device page's own rail row |
| `?path=3` → `deviceControlOld` | `Plater.cpp`, for a non-Snapmaker host on 127.0.0.1 |
| `?path=discovery` | `WebDeviceDialog`, the Add-Device dialog |

**The Snapmaker login is not part of any of this.** `sw_UserLogin` opens
`SMUserLogin`, a native wxDialog that loads `https://id.snapmaker.com?from=orca` —
Snapmaker's own login page, over the network, not out of the bundle. Nothing about it
changed and nothing about it should: no reconstructed page has a login form, and the
Device page's rail asks for that dialog rather than offering one.

## What the reconstructions still do not do

- Firmware update
- The popup's printer picker (it resolves from `sw_GetConnectedMachine` only), and a
  real upload — progress is simulated and `sw_GetPrintZip`'s content is unused
- Cloud printing and account binding, which is the account surface rather than the
  machine's

Device discovery, pairing, the file browser, the camera and the timelapses are built; that
list is older than they are. `check_coverage.py` is the current answer to this question —
every command is either issued by a module a panel is handed or excluded with a reason.

## Verifying which one you are looking at

The reconstructions carry a [build badge](02-build-badge.md); the Flutter bundle does
not. If the badge is present you are on the reconstruction, and it names the surface,
the version, the bundle build number and the git commit.
