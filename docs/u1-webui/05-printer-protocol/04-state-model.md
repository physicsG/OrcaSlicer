# Machine state model

The Device page subscribes to a fixed set of Klipper/Snapmaker objects with an explicit
per-object field filter. Both are literals in the bundle and are recovered by
[`tools/extract_state_model.py`](../tools/extract_state_model.py) →
[`data/state-model.json`](../data/state-model.json).

This is the most useful single artefact here: it is the complete list of everything the
Device page knows about the printer.

## Subscription list

24 objects, sent as the `objects` map of `printer.objects.subscribe` / `.query`:

```
extruder            extruder1           extruder2           extruder3
heater_bed          virtual_sdcard      print_stats         display_status
gcode_move          webhooks            idle_timeout        job
file_metadata       print_task_config   motion_report       purifier
fan                 fan_generic cavity_fan                  led cavity_led
filament_feed left  filament_feed right filament_detect     defect_detection
machine_state_manager
```

`extruder` + `extruder1..3` confirm the U1's **four toolheads** (Klipper names the first
one `extruder`, not `extruder0`). Object names containing a space —
`led cavity_led`, `fan_generic cavity_fan`, `filament_feed left/right` — follow Klipper's
`<section> <name>` convention.

## Field filters

`null` = subscribe to every field of that object.

| Object | Fields |
|---|---|
| `extruder`, `extruder1..3` | `temperature`, `target`, `power`, `can_extrude`, `pressure_advance`, `smooth_time`, `state`, `nozzle_diameter` |
| `heater_bed` | `temperature`, `target` |
| `print_stats` | `filename`, `state`, `total_duration`, `print_duration`, `filament_used`, `message`, `info` |
| `virtual_sdcard` | `progress`, `file_position`, `is_active`, `file_size`, `file_path` |
| `display_status` | `progress`, `message` |
| `gcode_move` | `speed_factor`, `speed`, `extrude_factor` |
| `webhooks` | `state`, `state_message` |
| `fan` | `speed` |
| `fan_generic cavity_fan` | `speed` |
| `led cavity_led` | `color_data` |
| `purifier` | `power_detected`, `power_det_value`, `mode`, `exhaust_fan`, `inner_fan` |
| `machine_state_manager` | `main_state`, `action_code` |
| `configfile` | `settings` |
| `print_task_config` | 23 fields — see below |
| `toolhead`, `motion_report`, `defect_detection`, `filament_detect`, `filament_feed left`, `filament_feed right` | *null (all fields)* |
| `idle_timeout`, `job`, `file_metadata` | *null (all fields)* — fall through the default arm |

The selection rule for extruders is a substring test, not an exact match: any object whose
name contains `extruder` gets the extruder field list. That is why a U1 with more heads
would need no client change.

### `print_task_config` — the Snapmaker-specific job object

```
filament_vendor          filament_type            filament_sku
filament_official        filament_sub_type        filament_color
filament_color_rgba      filament_color_multi     filament_soft
filament_edit            filament_exist
extruder_map_table       extruders_used           extruders_replenished
auto_bed_leveling        flow_calibrate           flow_calib_extruders
shaper_calibrate         save                     time_lapse_camera
auto_replenish_filament  can_auto_replenish       auto_replenish_index
```

This carries the whole multi-material story: which filament sits in which toolhead
(`extruder_map_table`), which heads a job uses (`extruders_used`), and the auto-replenish
state used when a spool runs out mid-print.

## Typed models

The bundle's Dart classes still carry their original names and field names in their
`toString()` literals, recovered by
[`tools/extract_dart_classes.py`](../tools/extract_dart_classes.py) →
[`data/dart-classes.json`](../data/dart-classes.json). The state-bearing ones:

| Class | Fields |
|---|---|
| `Extruder` | `index`, `temperature`, `target`, `power`, `canExtruder`, `pressureAdvance`, `smoothTime`, `state`, `nozzleDiameter` |
| `HeaterBed` | wire: `name`, `temperature`, `target` |
| `PrintStats` | `printDuration`, `filamentUsed`, `state`, `message`, `filename`, `fileMetadata`, `info` |
| `VirtualSdcard` | `fileSize`, `filePath`, `isActive`, `progress` |
| `PrintTaskConfig` | `filamentVendor`, `filamentType`, `filamentSubType`, `filamentOfficial`, `filamentColor`, `filamentColorRgba`, `extruderMapTable`, `timeLapseCameraFlag`, `autoBedLevelingFlag`, `filamentEdit`, `filamentExist`, `extrudersUsed`, `autoReplenishFilamentFlag`, `canAutoReplenishFlag`, `autoReplenishIndex`, `nozzleDiameters` |
| `MachineStateManager` | wire: `main_state`, `action_code` |
| `PurifierFan` | `powerDetValue`, `mode`, `exhaustFan`, `innerFan` |
| `ExhaustFan` | `delay`, `speedThreshold` |
| `InnerFan` | `rpm`, `delay`, `work`, `speedThreshold` |
| `ExtruderFilamentStatus` | `filamentDetected`, `disableAuto`, `channelState`, `channelError` |
| `DeviceException` | `index`, `code`, `level`, `message` |
| `FilamentItem` | `usedG`, `colorHex`, `usedM` |
| `DeviceStorageSpace` | wire: `free_space`, `total_space`, `units` |

And the device/session models:

| Class | Fields |
|---|---|
| `DeviceModel` | `key`, `ip`, `txtIp`, `port`, `clientId`, `id`, `devId`, `nozzleSizes`, `presetName`, `deviceConnectionState`, `name`, `deviceName`, `img`, `machineType`, `deviceModel`, `productCode`, `sn`, `authCode`, `userid`, `accessCode`, `linkMode`, `connected`, `status`, `online`, `isBind`, `deviceVersion`, `certConfig` |
| `DeviceCertConfig` | `endpoint`, `port`, `clientId`, `cert`, `key`, `ca`, `subscribeTopics`, `publishTopics` |
| `CameraMonitorResponse` | `urlType`, `isNewDevice`, `salt`, `iterations`, `hasPw` |
| `User` | `nickname`, `userid`, `email`, `account`, `status`, `icon`, `token`, `cellphone` |
| `UploadTaskState` | `result`, `isDone`, `isError`, `errorMessage`, `detailMessage`, `filePath`, `printStarted`, `checksum` |
| `DirectPrintParams` | `profile`, `filename`, `filepath`, `fileSize`, `fileChecksum` |

`DeviceModel.linkMode` distinguishes LAN from cloud; `authCode` / `accessCode` feed the
pairing handshake.

## `print_stats.state` — a spelling trap

The bundle's `PrintState` enum carries an ordinal-to-wire-string getter, which is the
authority for what actually appears in `print_stats.state`:

| Ordinal | Wire value |
|---:|---|
| 0 | `unknown` |
| 1 | `ready` |
| 2 | `standby` |
| 3 | `printing` |
| 4 | `paused` |
| 5 | `cancelled` |
| 6 | `error` |
| 7 | `complete` |

The Dart *member* for ordinal 7 is named `completed`, but the value it emits is
`complete` — Klipper's own spelling. A client that matches on `completed` will never
see a finished print.

## Status push shape

Pushes arrive on `<SN>/status` as a partial state — only changed objects and only their
filtered fields. Clients must merge, not replace. Values sit under `params`/`status`
keyed by object name, matching Moonraker's `notify_status_update` convention.
