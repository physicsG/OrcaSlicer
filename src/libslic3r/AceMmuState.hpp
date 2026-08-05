#ifndef slic3r_AceMmuState_hpp_
#define slic3r_AceMmuState_hpp_

// Pure, GUI-independent model of the multiACE printer-side state, parsed from the
// raw `/multiace/api/state` payload (see docs/ace-mmu/02-multiace-printer-api.md).
//
// This lives in libslic3r (not the GUI layer) so it can be unit-tested without
// pulling in wxWidgets or MachineObject; the GUI-side AceMmuProvider includes it
// and projects an AceSnapshot onto MachineObject::amsList.

#include "nlohmann/json.hpp"

#include <cctype>
#include <optional>
#include <string>
#include <vector>

namespace Slic3r { namespace AceMmu {

inline constexpr int SLOT_COUNT = 4; // slots per ACE unit; T = ace*4 + slot

// One slot within an ACE unit -> maps to an Orca AmsTray.
struct AceSlot
{
    int         idx      = 0;     // 0..3 -> AmsTray::id
    bool        occupied = false; // state != empty && raw != 0
    std::string state;            // empty|ready|loading|unloading|error|feeding|assist|unknown
    int         raw  = 0;         // gate_status int (0 = empty)
    int         rfid = 0;         // 0 = none, 2 = RFID read OK
    std::string material;         // "PLA"
    std::string brand;            // vendor
    std::string sku;
    std::string subtype;      // e.g. Matte / Silk
    std::string color_rrggbb; // lowercase "#rrggbb" or empty
    std::string source;       // rfid|override|derived|empty|null

    // Identity is trustworthy when it came from a spool tag or an explicit
    // override (mirrors multiACE's own lookup_live_slots filter).
    bool identity_trusted() const { return source == "rfid" || source == "override"; }
};

// One ACE unit -> maps to an Orca Ams.
struct AceUnit
{
    int                   idx       = 0; // 0..3 -> Ams::id
    bool                  connected = false;
    std::string           protocol; // "" | v1 | v2 (ACE Pro vs ACE 2 Pro)
    std::string           status;   // raw ace status string
    std::optional<double> temp;     // internal temperature, if reported
    std::optional<int>    humidity; // raw humidity percent (0..100), if reported
    std::optional<int>    dryer_remaining_minutes;
    std::vector<AceSlot>  slots;
};

struct AceSnapshot
{
    int                   device_count  = 0; // authoritative "how many ACE units to expose"
    int                   active_device = 0;
    std::string           mode;          // normal|multi|head
    std::string           printer_state; // idle|busy|printing|paused|complete|error
    std::string           ace_status;    // top-level ACE status (string on real firmware)
    std::optional<double> ace_temp;
    std::vector<AceUnit>  units;

    const AceUnit* find_unit(int idx) const
    {
        for (const AceUnit& u : units)
            if (u.idx == idx)
                return &u;
        return nullptr;
    }
};

// Orca's flat tray index: T = unit*4 + slot, identical to multiACE's toolhead
// numbering and to `MachineObject::tray_index = ams_id*4 + tray_id`.
inline int ace_tray_index(int unit_idx, int slot_idx) { return unit_idx * SLOT_COUNT + slot_idx; }

// `ams_exist_bits`: bit `unit.idx` set for every connected ACE unit.
inline long ace_ams_exist_bits(const AceSnapshot& snap)
{
    long bits = 0;
    for (const AceUnit& u : snap.units)
        if (u.connected && u.idx >= 0)
            bits |= (1L << u.idx);
    return bits;
}

// `tray_exist_bits`: bit `unit.idx*4 + slot.idx` set for every occupied slot.
inline long ace_tray_exist_bits(const AceSnapshot& snap)
{
    long bits = 0;
    for (const AceUnit& u : snap.units) {
        if (u.idx < 0)
            continue;
        for (const AceSlot& s : u.slots)
            if (s.occupied && s.idx >= 0)
                bits |= (1L << ace_tray_index(u.idx, s.idx));
    }
    return bits;
}

// "#83afff" -> "83AFFFFF" (Orca stores colour as 8-hex RRGGBBAA). Empty/invalid
// input yields an empty string so callers can fall back to a default.
inline std::string ace_color_to_rrggbbaa(const std::string& hash_rrggbb)
{
    std::string s = hash_rrggbb;
    if (!s.empty() && s.front() == '#')
        s.erase(s.begin());
    if (s.size() != 6)
        return {};
    for (char& c : s) {
        if (!std::isxdigit(static_cast<unsigned char>(c)))
            return {};
        c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    }
    return s + "FF";
}

namespace detail {

// A "status-ish" JSON value may be a string ("ready") or an int on some
// firmware; normalise to a string. Null/absent -> empty.
inline std::string as_status_string(const nlohmann::json& parent, const char* key)
{
    if (!parent.contains(key) || parent.at(key).is_null())
        return {};
    const nlohmann::json& v = parent.at(key);
    if (v.is_string())
        return v.get<std::string>();
    if (v.is_number_integer())
        return std::to_string(v.get<long long>());
    if (v.is_number_unsigned())
        return std::to_string(v.get<unsigned long long>());
    return {};
}

inline std::string opt_string(const nlohmann::json& parent, const char* key)
{
    if (!parent.contains(key) || !parent.at(key).is_string())
        return {};
    return parent.at(key).get<std::string>();
}

inline int opt_int(const nlohmann::json& parent, const char* key, int fallback)
{
    if (!parent.contains(key) || !parent.at(key).is_number_integer())
        return fallback;
    return parent.at(key).get<int>();
}

inline std::optional<double> opt_number(const nlohmann::json& parent, const char* key)
{
    if (!parent.contains(key) || !parent.at(key).is_number())
        return std::nullopt;
    return parent.at(key).get<double>();
}

inline std::optional<int> opt_int_null(const nlohmann::json& parent, const char* key)
{
    if (!parent.contains(key) || !parent.at(key).is_number_integer())
        return std::nullopt;
    return parent.at(key).get<int>();
}

inline AceSlot parse_slot(const nlohmann::json& j, int index_fallback)
{
    AceSlot slot;
    slot.idx          = opt_int(j, "idx", index_fallback);
    slot.state        = opt_string(j, "state");
    slot.raw          = opt_int(j, "raw", 0);
    slot.rfid         = opt_int(j, "rfid", 0);
    slot.material     = opt_string(j, "material");
    slot.brand        = opt_string(j, "brand");
    slot.sku          = opt_string(j, "sku");
    slot.subtype      = opt_string(j, "subtype");
    slot.color_rrggbb = opt_string(j, "color");
    slot.source       = opt_string(j, "source");

    const bool has_raw = j.contains("raw") && j.at("raw").is_number_integer();
    slot.occupied      = !slot.state.empty() && slot.state != "empty" && (!has_raw || slot.raw != 0);
    return slot;
}

inline std::optional<int> parse_dryer_remaining(const nlohmann::json& unit)
{
    if (!unit.contains("dryer") || !unit.at("dryer").is_object())
        return std::nullopt;
    const nlohmann::json& d = unit.at("dryer");
    // multiACE reports remaining under "remain_time" (minutes) or "remaining".
    if (auto v = opt_int_null(d, "remain_time"))
        return v;
    return opt_int_null(d, "remaining");
}

inline AceUnit parse_unit(const nlohmann::json& j, int index_fallback)
{
    AceUnit unit;
    unit.idx                     = opt_int(j, "idx", index_fallback);
    unit.connected               = j.contains("connected") && j.at("connected").is_boolean() ? j.at("connected").get<bool>() : false;
    unit.protocol                = opt_string(j, "protocol");
    unit.status                  = as_status_string(j, "status");
    unit.temp                    = opt_number(j, "temp");
    unit.humidity                = opt_int_null(j, "humidity");
    unit.dryer_remaining_minutes = parse_dryer_remaining(j);

    if (j.contains("slots") && j.at("slots").is_array()) {
        int i = 0;
        for (const nlohmann::json& sj : j.at("slots")) {
            if (sj.is_object())
                unit.slots.emplace_back(parse_slot(sj, i));
            ++i;
        }
    }
    return unit;
}

} // namespace detail

// Parse a raw multiACE `/api/state` (or `/api/aces`) document. Tolerant of
// missing/extra fields and nulls: unknown shapes degrade to empty/defaults
// rather than throwing, so a partial payload never clears good inventory.
inline AceSnapshot parse_ace_state(const nlohmann::json& j)
{
    AceSnapshot snap;
    if (!j.is_object())
        return snap;

    snap.device_count  = detail::opt_int(j, "device_count", 0);
    snap.active_device = detail::opt_int(j, "active_device", 0);
    snap.mode          = detail::opt_string(j, "mode");
    snap.printer_state = detail::opt_string(j, "printer_state");
    snap.ace_status    = detail::as_status_string(j, "ace_status");
    snap.ace_temp      = detail::opt_number(j, "ace_temp");

    if (j.contains("aces") && j.at("aces").is_array()) {
        int i = 0;
        for (const nlohmann::json& uj : j.at("aces")) {
            if (uj.is_object())
                snap.units.emplace_back(detail::parse_unit(uj, i));
            ++i;
        }
    }

    // device_count is authoritative; if absent, fall back to the array length.
    if (snap.device_count == 0)
        snap.device_count = static_cast<int>(snap.units.size());
    return snap;
}

inline AceSnapshot parse_ace_state(const std::string& text)
{
    return parse_ace_state(nlohmann::json::parse(text, nullptr, /*allow_exceptions=*/false));
}

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuState_hpp_
