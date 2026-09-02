# Error codes

## Two tables

The bundle ships two unrelated error tables. Only the second is the U1's.

| Table | Source | Shape | Status |
|---|---|---|---|
| Legacy | `assets/files/deviceError.json` | 8 hex digits, `{ecode, intro}` | Inherited from the Bambu-derived codebase — its text still refers to "Bambu Cloud" and "AMS". Not U1. |
| **Live** | `assets/i10n/{en,zh-CN}.json` | 16 hex digits, `error_<code>_title` + `error_<code>_desc` | **442 codes**, U1-specific, localised. |

Generated catalogue: [`data/error-catalog.json`](../data/error-catalog.json), built by
[`tools/extract_error_catalog.py`](../tools/extract_error_catalog.py). The legacy table is
kept verbatim at [`data/error-codes.json`](../data/error-codes.json).

## Code structure

Each live code is 16 hex digits — four 16-bit groups:

```
        0002    0523    0001    0000
        ────    ────    ────    ────
        class  subsys   unit    specific
```

| Group | Observed values | Meaning |
|---|---|---|
| **class** | `0001` (48), `0002` (248), `0003` (146) | Error class / severity |
| **subsystem** | 10 values, see below | Which subsystem raised it |
| **unit index** | `0000`–`0005`, `0100` | Toolhead index for per-head faults (`0000`–`0003`); `0000` also means machine-wide |
| **specific** | 55 values | The particular fault |

The class field almost certainly maps to `DeviceException.level`, which the bundle models
as `DeviceException{index, code, level, message}` — `index` matching the unit group. The
exact severity semantics of `0001`/`0002`/`0003` are **not confirmed** from the client
alone; only the distribution and the message text are directly observed.

### Subsystems

| Code | Subsystem | Count | Representative titles |
|---|---|---:|---|
| `0523` | Toolhead | 195 | Toolhead Picking Failure, Toolhead Swapping Anomaly, Nozzle Temperature Anomaly |
| `0525` | Filament | 96 | Filament Anomaly, Filament Pre-loading Anomaly, Extrusion Anomaly |
| `0530` | Calibration / detection | 53 | Calibration Anomaly, Heated Bed Detection Anomaly, Homing Calibration Failed |
| `0522` | System / motion | 42 | System Anomaly, System Failed to Start, Axis Movement Anomaly |
| `0528` | Homing / axis | 30 | Homing Anomaly, Axis Movement Anomaly, Sensor Anomaly |
| `0531` | Job / storage | 17 | Print Start Failed, Modification Failed, Storage Space Low |
| `0532` | Defect detection (vision) | 4 | Possible Foreign Object Detected on Print Bed, Possible Spaghetti Defect Detected |
| `0533` | Top cover / chamber | 2 | Top Cover Anomaly, Chamber Temperature Anomaly |
| `0526` | Heated bed | 2 | Heated Bed Temperature Abnormal |
| `0527` | Chamber | 1 | Chamber Temperature Abnormal |

The distribution is itself informative: **two thirds of all faults are toolhead or
filament faults**, which is what a four-head tool-changer with automatic filament handling
would predict.

## Per-toolhead expansion

Per-head faults occupy consecutive unit indices. The same fault appears four times:

| Code | Title | Description |
|---|---|---|
| `0002052300000000` | Filament Anomaly | Filament runout detected in **Toolhead 1** |
| `0002052300010000` | Filament Anomaly | Filament runout detected in **Toolhead 2** |
| `0002052300020000` | Filament Anomaly | Filament runout detected in **Toolhead 3** |
| `0002052300030000` | Filament Anomaly | Filament runout detected in **Toolhead 4** |

So a client should decode the unit group rather than table-matching all 442 codes:
`toolhead = unit_index + 1` for subsystem `0523`/`0525` faults.

## Retrieval

Active faults are pulled with `server.exception.query` (bridge: `sw_exception_query`) and
pushed as part of the `defect_detection` and `machine_state_manager` objects —
`machine_state_manager.action_code` carries the code that the UI turns into a title/desc
pair via this table.

## Vision-based detection

Subsystem `0532` corresponds to the features named in `version.changelog` for 2026-07-27:
"Filament Tangle Detection" and "Foreign Object Detection". These are configured through
`printer.defect_detection.config` (bridge: `sw_PrinterDefectDetection`,
`sw_DefectDetactionConfig` — note the typo in Orca's handler name).
