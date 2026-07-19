# 03 · Orca AMS Data Model & U1 Connection

All references are to this repository (`src/…`). Line numbers drift; use the
symbol names.

## 3.1 The AMS classes

Defined in [src/slic3r/GUI/DeviceManager.hpp](../../src/slic3r/GUI/DeviceManager.hpp):

### `class Ams` — one AMS unit (→ one ACE)

```cpp
class Ams {
    Ams(std::string ams_id, int nozzle_id, int type_id);
    std::string                      id;                 // "0".."3"
    int                              left_dry_time = 0;
    int                              humidity = 5;        // 1..5 bucket
    int                              humidity_raw = -1;
    float                            current_temperature = INVALID_AMS_TEMPERATURE;
    bool                             is_exists{false};
    std::map<std::string, AmsTray*>  trayList;            // key = tray id "0".."3"
    int nozzle;                                           // which extruder/nozzle
    int type{1};    // 0:dummy 1:ams 2:ams-lite 3:n3f 4:n3s
};
```

### `class AmsTray` — one slot (→ one ACE slot)

```cpp
class AmsTray {
    std::string id;                 // "0".."3"
    std::string tag_uid;            // RFID uid ("0" if none)
    std::string setting_id;         // tray_info_idx (filament preset id)
    std::string filament_setting_id;
    std::string type;               // "PLA", "PETG", ...
    std::string sub_brands;
    std::string color;              // 8-hex "RRGGBBAA"
    std::vector<std::string> cols;  // multi-colour
    std::string weight, diameter, temp, time;
    std::string nozzle_temp_max, nozzle_temp_min;
    int         ctype = 0;
    wxColour    wx_color;
    bool        is_bbl;
    bool        is_exists = false;
    int         remain = 0;         // 0..100 %
    // ...
    static wxColour decode_color(const std::string& color); // parses RRGGBBAA
    bool is_tray_info_ready();      // has type+color -> usable for mapping
    std::string get_filament_type();
};
```

### On `MachineObject`

```cpp
std::map<std::string, Ams*> amsList;   // key: ams id, "0".. ; the whole inventory
long ams_exist_bits = 0;               // bit k set => ACE k present
long tray_exist_bits = 0;              // bit (ams*4+tray) set => slot occupied
bool has_ams() { return ams_exist_bits != 0; }
bool is_support_ams_mapping();         // currently: return true;
int  ams_filament_mapping(std::vector<FilamentInfo> filaments,
                          std::vector<FilamentInfo>& result,
                          std::vector<int> exclude_id = {});
```

`VIRTUAL_TRAY_ID` (used with values 254/255) represents the external/bypass
spool; ACE integration does not need it but must not break it.

## 3.2 How `amsList` is normally filled (MQTT push)

`MachineObject::parse_json(payload)`
([src/slic3r/GUI/DeviceManager.cpp](../../src/slic3r/GUI/DeviceManager.cpp)) is
called for every MQTT status message (dispatched from
[GUI_App.cpp](../../src/slic3r/GUI/GUI_App.cpp) `obj->parse_json(msg)`). The AMS
branch reads `jj["ams"]`:

- `ams_exist_bits`, `tray_exist_bits`, `tray_read_done_bits`,
  `tray_is_bbl_bits`, `version` (hex strings).
- `jj["ams"]["ams"]` — an array. For each element:
  - `id` → looked up/created in `amsList` (`new Ams(ams_id, nozzle_id, type_id)`).
  - `info` bit-field → `type_id = bits[0..4]`, `nozzle_id = bits[8..4]`.
  - `humidity`, `humidity_raw`, `temp`, `dry_time`.
  - `tray[]` — for each: `id` → looked up/created in `trayList`
    (`new AmsTray(tray_id)`), then `tag_uid`, `tray_info_idx`, `tray_type`,
    `tray_sub_brands`, `tray_weight`, `tray_diameter`, `tray_temp`, `tray_time`,
    `bed_temp_type`, `tray_color`/`cols`, etc.

**The ACE provider must produce the equivalent of this parsed result.** Whether
it (a) synthesizes an `ams`-shaped JSON and calls `parse_json`, or (b) writes
`Ams`/`AmsTray` objects directly, is a design choice — see
[04-provider-design.md](04-provider-design.md).

## 3.3 The filament-mapping numbering (the linchpin)

`MachineObject::ams_filament_mapping(...)` builds the tray inventory:

```cpp
for (auto ams : amsList)
  for (auto tray : ams->trayList) {
      int ams_id   = atoi(ams->first);
      int tray_id  = atoi(tray->first);
      int tray_index = ams_id * 4 + tray_id;    // <-- global filament index
      // info.ams_id = ams->first;  info.slot_id = tray->first;
  }
```

and `FilamentInfo` ([src/libslic3r/ProjectTask.hpp](../../src/libslic3r/ProjectTask.hpp))
carries both the legacy `tray_id` and the new `ams_id` / `slot_id`:

```cpp
struct FilamentInfo {
    int id;             // = extruder id (slicer filament index)
    std::string type, color, filament_id, brand;
    int tray_id;        // legacy global index
    int mapping_result;
    std::string ams_id;  // new AMS mapping
    std::string slot_id;
};
```

Because `tray_index = ams_id*4 + tray_id` **equals** multiACE's
`T = ace*4 + slot`, mapping ACE `k` → `Ams(id="k")` and slot `s` →
`AmsTray(id="s")` makes the *existing* mapping emit exactly the indices multiACE
expects. This is the reason the integration is a provider, not an algorithm
change. Details in [06-slicing-gcode-mapping.md](06-slicing-gcode-mapping.md).

## 3.4 The GUI consumers (already work off `amsList`)

- [StatusPanel::update_ams](../../src/slic3r/GUI/StatusPanel.cpp) iterates
  `obj->amsList` → builds `AMSinfo` (`AMSItem.cpp` `AMSinfo::parse_ams_info`) →
  `AMSControl::UpdateAms(...)`.
- [AmsMappingPopup](../../src/slic3r/GUI/AmsMappingPopup.cpp) builds `TrayData`
  with `ams_id`/`slot_id` from `amsList` for the filament→slot picker.
- [SelectMachineDialog::reset_and_sync_ams_list](../../src/slic3r/GUI/SelectMachine.cpp)
  and [CalibrationPresetPage::sync_ams_info](../../src/slic3r/GUI/CalibrationWizardPresetPage.cpp)
  read the same structures.

So once `amsList` is populated for the U1, the AMS device tab, the send-to-print
mapping popup, and calibration all light up **with no UI changes**.

## 3.5 How the U1 connects (transport)

- The U1 is represented by a `MachineObject` (Bambu-style) with `dev_ip`,
  `is_local()`, `access_code`/`user_access_code`, `local_use_ssl_for_mqtt`.
- As a *print host* it uses **`Moonraker_Mqtt`**
  ([src/slic3r/Utils/MoonRaker.cpp](../../src/slic3r/Utils/MoonRaker.cpp),
  `PrintHost::get_print_host` → `htMoonRaker_mqtt`). This wraps Moonraker over an
  MQTT tunnel (TLS params: `ca`, `cert`, `key`, `port`, `clientId`, `sn`).
- Device/AMS/status messages arrive as JSON and are handed to
  `MachineObject::parse_json` (see §3.2).

**Implication for the provider:** the slicer already knows the U1's IP
(`dev_ip`) and holds its access credentials. The `AceMmuProvider` can reuse
`dev_ip` to build the `https://<dev_ip>/multiace/…` base URL, and reuse the
existing local-SSL trust handling. It should attach to the same `MachineObject`
so it writes into the correct `amsList`.

## 3.6 `is_support_ams_mapping()` and capability gating

Today `MachineObject::is_support_ams_mapping()` returns `true` unconditionally.
The provider should ensure the U1 reports AMS support so mapping is enabled, and
that `has_ams()` becomes true once ACE units are discovered
(`ams_exist_bits != 0`). See the capability discussion in
[05-implementation-plan.md](05-implementation-plan.md) §Phase 2.
