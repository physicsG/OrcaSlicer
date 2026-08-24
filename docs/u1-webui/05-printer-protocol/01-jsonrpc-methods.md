# JSON-RPC method surface

The printer speaks **JSON-RPC 2.0**. The namespaces `printer.*`, `server.*`, `machine.*`
come from [Moonraker](https://moonraker.readthedocs.io/); Snapmaker has added
`printer.control.*`, `server.client_manager.*`, `camera.*`, `custom.*`, `system.*` and
extended `server.files.*`.

Envelope:

```json
{ "jsonrpc": "2.0", "method": "printer.control.bed_temp",
  "params": { "temp": 60 }, "id": 7443000123456789 }
```

Methods and parameter names below are extracted from the Flutter bundle by
[`tools/extract_rpc.py`](../tools/extract_rpc.py) — that is, they are what the Device page
actually sends. Machine-readable form: [`data/jsonrpc-methods.json`](../data/jsonrpc-methods.json).

`dynamic` marks a call whose params map is assembled at runtime, so the key list is not a
literal in the bundle; the C++ counterpart in `MoonRaker.cpp` is cited where it resolves one.

## Print control

| Method | Params |
|---|---|
| `printer.print.start` | `filename` |
| `printer.print.pause` | — |
| `printer.print.resume` | — |
| `printer.print.cancel` | — |
| `printer.gcode.script` | `script` |
| `printer.bed_mesh.abort_probe_mesh` | — (C++ only; page reaches it via `sw_BedMesh_AbortProbeMesh`) |

## Hardware control — Snapmaker extension

Standard Moonraker drives hardware with G-code. Snapmaker added typed methods instead:

| Method | Params | Notes |
|---|---|---|
| `printer.control.bed_temp` | `temp` | |
| `printer.control.extruder_temp` | `temp`, `index`, `map` | per-toolhead; `index` selects the head |
| `printer.control.main_fan` | `speed` | |
| `printer.control.generic_fan` | `name`, `speed` | e.g. `name: "cavity_fan"` |
| `printer.control.led` | `name`, `white` | e.g. `name: "cavity_led"` |
| `printer.control.print_speed` | `percentage` | |
| `printer.control.purifier` | *dynamic* | mode / exhaust / inner fan |
| `printer.defect_detection.config` | *dynamic* | first-layer & spaghetti detection |

## State

| Method | Params |
|---|---|
| `printer.objects.list` | — |
| `printer.objects.query` | `objects` |
| `printer.objects.subscribe` | `objects` |
| `printer.objects.setSubscribeFilter` | `objects`, `sn` |
| `printer.objects.unsubscribe` | *(named in the bundle; see `sw_UnSubscribeMachineState`)* |
| `printer.info` | — |
| `machine.system_info` | — |
| `machine.heartbeat` | — |
| `machine.set_device_name` | `name` |
| `system.get_device_info` | — |
| `server.exception.query` | — |

`objects` is a map of *object name → field list*, where `null` means every field. Its exact
contents are the [state model](04-state-model.md).

Note `printer.objects.setSubscribeFilter` — camelCase, unlike everything around it, and it
carries an `sn`. It is a Snapmaker addition layered onto Moonraker's subscription model.

## Files

| Method | Params |
|---|---|
| `server.files.roots` | — |
| `server.files.list_page` | `root`, `page_number`, `files_per_page` |
| `server.files.get_directory` | *(C++: `MoonRaker.cpp`)* |
| `server.files.metadata` | `filename` |
| `server.files.get_status` | — |
| `server.files.thumbnails` | *(C++)* |
| `server.files.thumbnails_base64` | `path` |
| `server.files.delete_file` | *(C++ only)* |
| `server.files.get_userdata_space` | *(C++)* |
| `server.files.pull` | *dynamic* — cloud→printer transfer |
| `server.files.cancel_pull` | *(C++)* |
| `server.files.start_local_print` | *(C++)* |
| `server.files.start_cloud_print` | *(C++)* |
| `server.files.metascan` | *(named in bundle strings)* |
| `custom.file.filament.objects.get_mapping` | `filename` — filament→toolhead mapping for a job |

## Pairing and client management

| Method | Params |
|---|---|
| `server.request_key` | `clientid` — the pairing bootstrap ([transport](03-mqtt-transport.md)) |
| `server.client_manager.request_pin_code` | `userid`, `nickname`, `app_id` |
| `server.client_manager.request_lan_auth` | `clientid`, `app_id` |
| `server.client_manager.confirm_lan_status` | `clientid` |
| `server.client_manager.set_userinfo` | *(C++)* |

## Camera and timelapse

| Method | Params |
|---|---|
| `camera.start_monitor` | *dynamic* |
| `camera.stop_monitor` | *dynamic* |
| `camera.get_timelapse_instance` | `page_index`, `page_rows`, `thumbnail_direct` |
| `camera.delete_timelapse_instance` | *dynamic* |

The live view is an HTTP still endpoint, `/files/camera/monitor.jpg`, not an RPC stream.
`camera.start_monitor` returns `CameraMonitorResponse{urlType, isNewDevice, salt,
iterations, hasPw}` — `salt` + `iterations` indicate a PBKDF2-derived credential for
newer devices, matched by `NewDeviceDecryptionParams{keyLength, ivLength}`.

## Async notifications (printer → client)

Delivered on `<SN>/notification`, dispatched by `method`:

`notify_camera_upload_timelapse`, `notify_file_pull_progress`, `notify_job_queue_changed`,
plus `job_loaded`, `jobs_added`, `jobs_removed`, `print_started`, `pre_print_failed`.
