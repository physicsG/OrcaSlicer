#ifndef slic3r_MultiAceAmsProjection_hpp_
#define slic3r_MultiAceAmsProjection_hpp_

#include "MultiAceInventory.hpp"

#include <algorithm>
#include <cctype>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace Slic3r::MultiAce {

inline constexpr int AMS_SLOTS_PER_UNIT = 4;

enum class ProjectedRoadPosition {
    Tray,
    Tube,
    Hotend,
};

enum class ProjectedStepState {
    Init,
    Loading,
    Completed,
};

struct AmsTrayProjection
{
    int unit_index = -1;
    int slot_index = -1;

    std::string ams_id;
    std::string tray_id;
    std::string source_id;
    std::string color_rgba;

    bool                  exists         = false;
    bool                  rfid_read_done = false;
    ProjectedRoadPosition road_position  = ProjectedRoadPosition::Tray;
    ProjectedStepState    step_state     = ProjectedStepState::Init;
    FilamentSource        source;
};

struct AmsUnitProjection
{
    int         unit_index = -1;
    std::string ams_id;
    int         nozzle = -1;

    int                   humidity_raw   = -1;
    int                   humidity_level = 5;
    std::optional<double> current_temperature;
    int                   dryer_remaining_seconds = 0;

    std::vector<AmsTrayProjection> trays;
};

struct AmsInventoryProjection
{
    std::string                    revision;
    std::vector<AmsUnitProjection> units;

    long ams_exist_bits       = 0;
    long tray_exist_bits      = 0;
    long tray_is_bbl_bits     = 0;
    long tray_read_done_bits  = 0;
    long tray_reading_bits    = 0;
};

namespace projection_detail {

inline int parse_canonical_decimal_id(const std::string& value, const char* field)
{
    if (value.empty())
        throw std::invalid_argument(std::string("multiACE ") + field + " must not be empty");
    if (value.size() > 1 && value.front() == '0')
        throw std::invalid_argument(std::string("multiACE ") + field + " must be a canonical decimal integer");

    int result = 0;
    for (const unsigned char character : value) {
        if (!std::isdigit(character))
            throw std::invalid_argument(std::string("multiACE ") + field + " must be a canonical decimal integer");
        const int digit = character - '0';
        if (result > (std::numeric_limits<int>::max() - digit) / 10)
            throw std::invalid_argument(std::string("multiACE ") + field + " is too large");
        result = result * 10 + digit;
    }
    return result;
}

inline bool is_hex_digit(const unsigned char character)
{
    return std::isdigit(character) || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F');
}

inline std::string normalize_color_rgba(std::string color)
{
    if (!color.empty() && color.front() == '#')
        color.erase(color.begin());
    if (color.size() != 6 && color.size() != 8)
        return {};
    if (!std::all_of(color.begin(), color.end(), [](unsigned char character) { return is_hex_digit(character); }))
        return {};

    std::transform(color.begin(), color.end(), color.begin(), [](unsigned char character) {
        return static_cast<char>(std::toupper(character));
    });
    if (color.size() == 6)
        color += "FF";
    return color;
}

inline bool contains_toolhead(const std::vector<int>& toolheads, int toolhead)
{
    return std::find(toolheads.begin(), toolheads.end(), toolhead) != toolheads.end();
}

inline int humidity_level(int humidity_raw)
{
    if (humidity_raw < 0)
        return 5;
    return std::clamp((humidity_raw + 19) / 20, 1, 5);
}

} // namespace projection_detail

inline AmsInventoryProjection project_inventory_to_ams(const InventorySnapshot& inventory)
{
    if (inventory.schema_version != SUPPORTED_SCHEMA_VERSION)
        throw std::invalid_argument("unsupported multiACE inventory schema version");
    if (inventory.revision.empty())
        throw std::invalid_argument("multiACE inventory revision must not be empty");

    struct UnitAccumulator
    {
        AmsUnitProjection projection;
        double            temperature_sum   = 0.0;
        int               temperature_count = 0;
        std::optional<int> common_nozzle;
        bool              nozzle_is_ambiguous = false;
    };

    AmsInventoryProjection        result;
    std::map<int, UnitAccumulator> units;
    std::set<std::pair<int, int>>  occupied_slots;
    const int                      usable_mask_bits = std::numeric_limits<long>::digits;

    result.revision = inventory.revision;

    for (const FilamentSource& source : inventory.sources) {
        if (source.id.provider != "multiace")
            throw std::invalid_argument("AMS projection only accepts multiace sources");

        const int unit_index = projection_detail::parse_canonical_decimal_id(source.id.unit_id, "unit_id");
        const int slot_index = projection_detail::parse_canonical_decimal_id(source.id.slot_id, "slot_id");
        if (slot_index < 0 || slot_index >= AMS_SLOTS_PER_UNIT)
            throw std::invalid_argument("multiACE slot_id must be between 0 and 3");

        const int flat_slot_index = unit_index * AMS_SLOTS_PER_UNIT + slot_index;
        if (unit_index >= usable_mask_bits || flat_slot_index >= usable_mask_bits)
            throw std::invalid_argument("multiACE unit and slot exceed the inherited AMS bit-mask capacity");
        if (!occupied_slots.emplace(unit_index, slot_index).second)
            throw std::invalid_argument("multiACE inventory contains duplicate unit and slot topology");

        if (source.loaded_toolhead.has_value() && !source.reachable_toolheads.empty() &&
            !projection_detail::contains_toolhead(source.reachable_toolheads, *source.loaded_toolhead)) {
            throw std::invalid_argument("multiACE loaded_toolhead is not reachable from its source");
        }

        UnitAccumulator& accumulator = units[unit_index];
        accumulator.projection.unit_index = unit_index;
        accumulator.projection.ams_id     = std::to_string(unit_index);

        AmsTrayProjection tray;
        tray.unit_index = unit_index;
        tray.slot_index = slot_index;
        tray.ams_id     = accumulator.projection.ams_id;
        tray.tray_id    = std::to_string(slot_index);
        tray.source_id  = source.id.str();
        tray.color_rgba = projection_detail::normalize_color_rgba(source.color);
        tray.exists     = source.state != SourceState::Empty;
        tray.rfid_read_done = tray.exists && source.metadata_origin == SourceMetadataOrigin::RFID && !source.rfid_uid.empty();
        tray.source         = source;

        if (source.loaded_toolhead.has_value()) {
            tray.road_position = ProjectedRoadPosition::Hotend;
            tray.step_state    = ProjectedStepState::Completed;
        } else if (source.state == SourceState::Loading || source.state == SourceState::Unloading) {
            tray.road_position = ProjectedRoadPosition::Tube;
            tray.step_state    = source.state == SourceState::Loading ? ProjectedStepState::Loading : ProjectedStepState::Init;
        }

        accumulator.projection.trays.emplace_back(std::move(tray));

        if (source.humidity_percent.has_value())
            accumulator.projection.humidity_raw = std::max(accumulator.projection.humidity_raw, *source.humidity_percent);
        if (source.temperature_c.has_value()) {
            accumulator.temperature_sum += *source.temperature_c;
            ++accumulator.temperature_count;
        }
        if (source.dryer_remaining_minutes.has_value()) {
            const int seconds = *source.dryer_remaining_minutes > std::numeric_limits<int>::max() / 60
                                    ? std::numeric_limits<int>::max()
                                    : *source.dryer_remaining_minutes * 60;
            accumulator.projection.dryer_remaining_seconds = std::max(accumulator.projection.dryer_remaining_seconds, seconds);
        }

        if (source.reachable_toolheads.size() != 1) {
            accumulator.nozzle_is_ambiguous = true;
        } else if (!accumulator.common_nozzle.has_value()) {
            accumulator.common_nozzle = source.reachable_toolheads.front();
        } else if (*accumulator.common_nozzle != source.reachable_toolheads.front()) {
            accumulator.nozzle_is_ambiguous = true;
        }

        result.ams_exist_bits |= 1L << unit_index;
        if (source.state != SourceState::Empty)
            result.tray_exist_bits |= 1L << flat_slot_index;
        if (source.metadata_origin == SourceMetadataOrigin::RFID && !source.rfid_uid.empty() && source.state != SourceState::Empty)
            result.tray_read_done_bits |= 1L << flat_slot_index;
    }

    result.units.reserve(units.size());
    for (auto& [unit_index, accumulator] : units) {
        (void) unit_index;
        std::sort(accumulator.projection.trays.begin(), accumulator.projection.trays.end(),
                  [](const AmsTrayProjection& lhs, const AmsTrayProjection& rhs) { return lhs.slot_index < rhs.slot_index; });
        accumulator.projection.humidity_level = projection_detail::humidity_level(accumulator.projection.humidity_raw);
        if (accumulator.temperature_count > 0)
            accumulator.projection.current_temperature = accumulator.temperature_sum / accumulator.temperature_count;
        if (!accumulator.nozzle_is_ambiguous && accumulator.common_nozzle.has_value())
            accumulator.projection.nozzle = *accumulator.common_nozzle;
        result.units.emplace_back(std::move(accumulator.projection));
    }

    return result;
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceAmsProjection_hpp_
