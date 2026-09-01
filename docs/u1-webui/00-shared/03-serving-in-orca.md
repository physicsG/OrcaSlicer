# Serving the reconstructions in Orca

Orca now loads the reconstructed Device tab and print-processing popup instead of the
shipped Flutter bundle. This page covers the wiring, how to switch back, and what you
lose by running the reconstructions.

## The switch

One config key decides it, read in one function:

```cpp
// GUI_App.cpp
wxString GUI_App::get_u1_surface_url(U1Surface surface) const
{
    const bool reconstructed = app_config->get_bool("u1_reconstructed_ui");
    ...
}
```

| `u1_reconstructed_ui` | Device tab | Print popup |
|---|---|---|
| `true` *(default)* | `/web/device_page/index.html` | `/web/print_processing/index.html?mode=print` \| `?mode=upload` |
| `false` | `/web/flutter_web/index.html?path=2` | `…?path=4` \| `…?path=5` |

Flip it in Orca's config file — `Snapmaker_Orca.conf` in the data directory — and
restart. No rebuild needed.

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
(`WebDeviceDialog`).

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

## What you lose

The reconstructions are deliberately narrower than the shipped bundle. With
`u1_reconstructed_ui` on, these are **not available**:

- Device discovery, pairing and authorisation
- Cloud login and the account surface
- The machine file browser, camera and timelapse
- Firmware update
- The popup's printer picker (it resolves from `sw_GetConnectedMachine` only), and a
  real upload — progress is simulated and `sw_GetPrintZip`'s content is unused

The Device tab covers live machine control; the popup covers the filament-mapping and
preferences flow. For anything else, switch back.

## Verifying which one you are looking at

The reconstructions carry a [build badge](02-build-badge.md); the Flutter bundle does
not. If the badge is present you are on the reconstruction, and it names the surface,
the version, the bundle build number and the git commit.
