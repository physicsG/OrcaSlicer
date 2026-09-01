# Strings, controls and limits

`assets/i10n/en.json` holds 1,241 keys — 360 UI strings and 876 error strings (442 codes ×
title/desc, plus a few singletons). The UI strings pin down the Device page's exact
control surface, including its validation ranges.

## Control surface

| Control | Label(s) | Limit / values | RPC |
|---|---|---|---|
| Heated bed temperature | `Heated Bed Temp.`, `Heated Bed` | **0–100 °C** | `printer.control.bed_temp{temp}` |
| Extruder temperature | `Extruder Temp.`, `Nozzle` | — | `printer.control.extruder_temp{temp,index,map}` |
| Print speed | `Print Speed` | **50–150 %** | `printer.control.print_speed{percentage}` |
| Main cooling fan | `Main Cooling Fan Speed` | — | `printer.control.main_fan{speed}` |
| Assist cooling fan | `Assist Cooling Fan Speed` | — | `printer.control.generic_fan{name,speed}` |
| Air purifier fan | `Air Purifier Fan Speed`, `Exhaust Fan Speed`, `Recirculation Fan Speed` | — | `printer.control.purifier` |
| Purifier mode | `Recirculation Mode`, `Exhaust Mode`, `Current Mode` | 2 modes | `printer.control.purifier` |
| Chamber LED | `Led` | on/off (`white`) | `printer.control.led{name:"cavity_led",white}` |
| Toolhead park/pick | `Park Extruder`, `Pick Extruder` | — | `printer.gcode.script` |

The exact limits come from the validation tips:

```
dialog_device_control_modify_heated_bed_temperature_tips
    "Heated bed temperature must be set between 0°C and 100°C"
dialog_device_control_modify_print_speed_tips
    "Print speed must be set between 50% and 150%"
```

## Machine activity strings

`machine_state_manager.main_state` / `action_code` are rendered through a fixed set of
activity strings. They are a readable map of the U1's automated routines:

| Phase | Strings |
|---|---|
| Startup checks | `Checking toolheads...`, `Checking Extruder Park...`, `Checking Extruder Pick...` |
| Bed | `Bed detecting...`, `Heated bed Calibrating` |
| Nozzle cleaning | `Cleaning Nozzle 1 (1/4)` … `Cleaning Nozzle 4 (4/4)`, `Wiping Nozzle...`, `Cooling Nozzle...` |
| Toolhead calibration | `Calibrating Toolhead 1...` … `4...`, `Extruder Docking Calibrating...` |
| Flow calibration | `Toolhead 1 Calibrating extrusion flow` … `4` |
| Print | `Paused`, `Resuming printing...`, `Resuming print...`, `Print Preprocessing` |

The consistent `(n/4)` and per-toolhead phrasing is another confirmation of the
four-head architecture.

## Confirmations and guards

| Key | Text |
|---|---|
| `cancel_print_confirm_message` | "Cancel printing Do you want to cancel the printing task ?" |
| `close_led_confirm_message` | "AI monitoring is enabled. Turning off the LED may reduce detection accuracy…" |
| `nozzle_mismatch_tip` | "The nozzle diameter does not match the preset…" |
| `direct_print_tips` | "'Print Now' is only available in Cloud Mode" |
| `camera_auto_shutdown_message` | Camera powers down after inactivity; `camera_turn_off_countdown` |
| `network_unstable_partial_operation_failed` | "Network unstable, partial operation may failed" |

`close_led_confirm_message` is a genuine coupling: the vision-based defect detection
(subsystem `0532`) depends on the chamber LED, so turning the light off degrades it.

## Discovery

| Key | Text |
|---|---|
| `discovery_tip1` | "1. Only printers within the same LAN can be found" |
| `discovery_tip2` | "2. The device only supports a 2.4GHz Wi-Fi connection" |
| `input_ip_address`, `Manual connect`, `Nearby machine` | Manual-IP fallback |

## Filament catalogue

`filament_color` maps 8-digit `#RRGGBBAA` hex to display names, and
`filament_official_color` maps numeric SKU ids (`34056`…) to official colour names.
`assets/packages/lava_device_control/assets/files/filament.json` carries the catalogue
itself, and the bundle models entries as `VenderMaterialModel{material, serie}` and
`FilamentColorModel{nameZh, rgba}`.
