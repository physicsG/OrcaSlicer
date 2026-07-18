#ifndef slic3r_MultiAceWebPayload_hpp_
#define slic3r_MultiAceWebPayload_hpp_

#include "MultiAceInventory.hpp"

#include "nlohmann/json.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iomanip>
#include <limits>
#include <map>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace Slic3r::MultiAce {
namespace web_detail {

inline void require_object(const nlohmann::json& value, const std::string& name)
{
    if (!value.is_object())
        throw std::invalid_argument(name + " must be a JSON object");
}

inline std::string optional_string(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return {};
    if (!object.at(field).is_string())
        throw std::invalid_argument(std::string("multiACE Web ") + field + " must be a string or null");
    return object.at(field).get<std::string>();
}

inline std::optional<bool> optional_bool(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return std::nullopt;
    if (!object.at(field).is_boolean())
        throw std::invalid_argument(std::string("multiACE Web ") + field + " must be a boolean or null");
    return object.at(field).get<bool>();
}

inline int checked_nonnegative_integer(const nlohmann::json& value, const std::string& name)
{
    if (!value.is_number_integer())
        throw std::invalid_argument(name + " must be a non-negative integer");

    if (value.is_number_unsigned()) {
        const unsigned long long number = value.get<unsigned long long>();
        if (number > static_cast<unsigned long long>(std::numeric_limits<int>::max()))
            throw std::invalid_argument(name + " is outside the supported range");
        return static_cast<int>(number);
    }

    const long long number = value.get<long long>();
    if (number < 0 || number > std::numeric_limits<int>::max())
        throw std::invalid_argument(name + " is outside the supported range");
    return static_cast<int>(number);
}

inline int required_index(const nlohmann::json& object, const char* field, const std::string& name)
{
    if (!object.contains(field))
        throw std::invalid_argument(name + "." + field + " is required");
    return checked_nonnegative_integer(object.at(field), name + "." + field);
}

inline std::optional<int> optional_bounded_integer(const nlohmann::json& object, const char* field, int minimum, int maximum)
{
    if (!object.contains(field) || object.at(field).is_null())
        return std::nullopt;
    const int value = checked_nonnegative_integer(object.at(field), std::string("multiACE Web ") + field);
    if (value < minimum || value > maximum)
        throw std::invalid_argument(std::string("multiACE Web ") + field + " is outside the supported range");
    return value;
}

inline std::optional<double> optional_number(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return std::nullopt;
    if (!object.at(field).is_number())
        throw std::invalid_argument(std::string("multiACE Web ") + field + " must be numeric or null");
    const double value = object.at(field).get<double>();
    if (!std::isfinite(value))
        throw std::invalid_argument(std::string("multiACE Web ") + field + " must be finite");
    return value;
}

inline int parse_object_index(const std::string& value, const std::string& name)
{
    if (value.empty())
        throw std::invalid_argument(name + " must be a non-negative integer");

    unsigned long long parsed = 0;
    for (const unsigned char character : value) {
        if (character < '0' || character > '9')
            throw std::invalid_argument(name + " must be a non-negative integer");
        const unsigned digit = character - '0';
        if (parsed > (static_cast<unsigned long long>(std::numeric_limits<int>::max()) - digit) / 10ULL)
            throw std::invalid_argument(name + " is outside the supported range");
        parsed = parsed * 10ULL + digit;
    }
    return static_cast<int>(parsed);
}

inline SourceMetadataOrigin parse_metadata_origin(const nlohmann::json& slot)
{
    const std::string source = optional_string(slot, "source");
    if (source == "rfid")
        return SourceMetadataOrigin::RFID;
    if (source == "override" || source == "manual")
        return SourceMetadataOrigin::Manual;
    if (source == "derived")
        return SourceMetadataOrigin::Derived;

    if (slot.contains("rfid") && !slot.at("rfid").is_null()) {
        const int rfid = checked_nonnegative_integer(slot.at("rfid"), "multiACE Web slot.rfid");
        if (rfid == 2)
            return SourceMetadataOrigin::RFID;
    }
    return SourceMetadataOrigin::Unknown;
}

inline SourceState parse_source_state(const std::string& value)
{
    if (value == "empty" || value.rfind("empty", 0) == 0)
        return SourceState::Empty;
    if (value == "ready" || value == "feeding" || value == "assist")
        return SourceState::Ready;
    if (value == "loading")
        return SourceState::Loading;
    if (value == "unloading")
        return SourceState::Unloading;
    if (value == "error")
        return SourceState::Error;
    if (value == "offline")
        return SourceState::Offline;
    return SourceState::Unknown;
}

inline DryerState parse_dryer_state(const nlohmann::json& dryer)
{
    if (dryer.is_null())
        return DryerState::Unknown;
    require_object(dryer, "multiACE Web dryer");

    const std::string status = optional_string(dryer, "status");
    if (status == "stop" || status == "stopped" || status == "off" || status == "idle")
        return DryerState::Off;
    if (status == "drying" || status == "run" || status == "running" || status == "heat" || status == "heating")
        return DryerState::Drying;
    if (status == "complete" || status == "completed" || status == "done")
        return DryerState::Complete;
    if (status == "error" || status == "failed")
        return DryerState::Error;
    return DryerState::Unknown;
}

inline std::optional<int> parse_dryer_remaining_minutes(const nlohmann::json& dryer)
{
    if (dryer.is_null() || !dryer.contains("remain_time") || dryer.at("remain_time").is_null())
        return std::nullopt;
    if (!dryer.at("remain_time").is_number())
        throw std::invalid_argument("multiACE Web dryer.remain_time must be numeric or null");

    const double seconds = dryer.at("remain_time").get<double>();
    if (!std::isfinite(seconds) || seconds < 0.0)
        throw std::invalid_argument("multiACE Web dryer.remain_time is outside the supported range");
    const double minutes = std::ceil(seconds / 60.0);
    if (minutes > static_cast<double>(std::numeric_limits<int>::max()))
        throw std::invalid_argument("multiACE Web dryer.remain_time is outside the supported range");
    return static_cast<int>(minutes);
}

inline std::map<std::pair<int, int>, int> parse_loaded_toolheads(const nlohmann::json& payload)
{
    std::map<std::pair<int, int>, int> loaded;
    if (!payload.contains("toolheads") || payload.at("toolheads").is_null())
        return loaded;
    if (!payload.at("toolheads").is_array())
        throw std::invalid_argument("multiACE Web toolheads must be an array");

    std::set<int> seen_toolheads;
    for (const nlohmann::json& toolhead : payload.at("toolheads")) {
        require_object(toolhead, "multiACE Web toolhead");
        const int head = required_index(toolhead, "idx", "multiACE Web toolhead");
        if (head >= PHYSICAL_TOOLHEAD_COUNT)
            throw std::invalid_argument("multiACE Web toolhead.idx contains an invalid U1 toolhead");
        if (!seen_toolheads.insert(head).second)
            throw std::invalid_argument("duplicate multiACE Web toolhead.idx: " + std::to_string(head));

        const std::optional<bool> source_known = optional_bool(toolhead, "head_source_known");
        if (source_known && !*source_known)
            continue;
        const bool has_ace  = toolhead.contains("ace") && !toolhead.at("ace").is_null();
        const bool has_slot = toolhead.contains("slot") && !toolhead.at("slot").is_null();
        if (!source_known && !has_ace && !has_slot)
            continue;
        if (!has_ace || !has_slot)
            throw std::invalid_argument("multiACE Web toolhead source requires both ace and slot");

        const int                 unit = checked_nonnegative_integer(toolhead.at("ace"), "multiACE Web toolhead.ace");
        const int                 slot = checked_nonnegative_integer(toolhead.at("slot"), "multiACE Web toolhead.slot");
        const std::pair<int, int> key{unit, slot};
        const auto [position, inserted] = loaded.emplace(key, head);
        if (!inserted && position->second != head)
            throw std::invalid_argument("multiACE Web source is loaded into multiple U1 toolheads");
    }
    return loaded;
}

inline std::map<int, std::vector<int>> parse_head_mode_routes(const nlohmann::json& payload)
{
    std::vector<int> ace_heads;
    if (payload.contains("ace_heads") && !payload.at("ace_heads").is_null()) {
        if (!payload.at("ace_heads").is_array())
            throw std::invalid_argument("multiACE Web ace_heads must be an array");
        for (const nlohmann::json& head_json : payload.at("ace_heads")) {
            const int head = checked_nonnegative_integer(head_json, "multiACE Web ace_heads entry");
            if (head >= PHYSICAL_TOOLHEAD_COUNT)
                throw std::invalid_argument("multiACE Web ace_heads contains an invalid U1 toolhead");
            ace_heads.emplace_back(head);
        }
    } else if (payload.contains("ace_head") && !payload.at("ace_head").is_null()) {
        const int head = checked_nonnegative_integer(payload.at("ace_head"), "multiACE Web ace_head");
        if (head >= PHYSICAL_TOOLHEAD_COUNT)
            throw std::invalid_argument("multiACE Web ace_head contains an invalid U1 toolhead");
        ace_heads.emplace_back(head);
    }
    std::sort(ace_heads.begin(), ace_heads.end());
    ace_heads.erase(std::unique(ace_heads.begin(), ace_heads.end()), ace_heads.end());

    std::map<int, int> head_ace;
    if (payload.contains("head_ace") && !payload.at("head_ace").is_null()) {
        if (!payload.at("head_ace").is_object())
            throw std::invalid_argument("multiACE Web head_ace must be a JSON object");
        for (const auto& entry : payload.at("head_ace").items()) {
            const int head = parse_object_index(entry.key(), "multiACE Web head_ace key");
            if (head >= PHYSICAL_TOOLHEAD_COUNT)
                throw std::invalid_argument("multiACE Web head_ace contains an invalid U1 toolhead");
            head_ace.emplace(head, checked_nonnegative_integer(entry.value(), "multiACE Web head_ace value"));
        }
    }

    std::map<int, std::vector<int>> routes;
    for (const int head : ace_heads) {
        int        unit  = head;
        const auto found = head_ace.find(head);
        if (found != head_ace.end())
            unit = found->second;
        routes[unit].emplace_back(head);
    }
    return routes;
}

inline std::string content_revision(const InventorySnapshot& inventory)
{
    nlohmann::json canonical = nlohmann::json::array();
    for (const FilamentSource& source : inventory.sources) {
        nlohmann::json serialized = {
            {"id", source.id.str()},
            {"rfid_uid", source.rfid_uid},
            {"material", source.material},
            {"subtype", source.subtype},
            {"brand", source.brand},
            {"color", source.color},
            {"metadata_origin", static_cast<int>(source.metadata_origin)},
            {"reachable_toolheads", source.reachable_toolheads},
        };
        canonical.emplace_back(std::move(serialized));
    }

    const std::string serialized = canonical.dump();
    std::uint64_t     hash       = UINT64_C(14695981039346656037);
    for (const unsigned char character : serialized) {
        hash ^= character;
        hash *= UINT64_C(1099511628211);
    }

    std::ostringstream output;
    output << "multiace-web:" << std::hex << std::setfill('0') << std::setw(16) << hash;
    return output.str();
}

} // namespace web_detail

inline ProviderCapabilities parse_multiace_web_capabilities(const nlohmann::json& payload)
{
    web_detail::require_object(payload, "multiACE Web version payload");
    if (payload.contains("error") && !payload.at("error").is_null())
        throw std::runtime_error("multiACE Web version request failed: " + web_detail::optional_string(payload, "error"));

    const std::string version = web_detail::optional_string(payload, "web");
    if (version.empty())
        throw std::invalid_argument("multiACE Web version payload requires a non-empty web version");

    ProviderCapabilities capabilities;
    capabilities.inventory          = true;
    capabilities.live_events        = true;
    capabilities.dryer_state        = true;
    capabilities.per_source_routing = true;
    return capabilities;
}

inline bool multiace_web_reports_disconnected(const nlohmann::json& payload)
{
    web_detail::require_object(payload, "multiACE Web state payload");
    return web_detail::optional_string(payload, "klippy") == "disconnected";
}

inline InventorySnapshot parse_multiace_web_inventory(const nlohmann::json& payload)
{
    web_detail::require_object(payload, "multiACE Web state payload");
    if (payload.contains("error") && !payload.at("error").is_null())
        throw std::runtime_error("multiACE Web state request failed: " + web_detail::optional_string(payload, "error"));
    if (multiace_web_reports_disconnected(payload))
        throw std::runtime_error("multiACE Web reports that Klippy is disconnected");
    if (!payload.contains("aces") || !payload.at("aces").is_array())
        throw std::invalid_argument("multiACE Web aces must be an array");

    const std::string                        mode             = web_detail::optional_string(payload, "mode");
    const std::map<std::pair<int, int>, int> loaded_toolheads = web_detail::parse_loaded_toolheads(payload);
    const std::map<int, std::vector<int>>    head_routes      = mode == "head" ? web_detail::parse_head_mode_routes(payload) :
                                                                                 std::map<int, std::vector<int>>{};

    InventorySnapshot             inventory;
    std::set<std::pair<int, int>> source_keys;
    std::set<std::pair<int, int>> loaded_sources_found;
    std::set<int>                 unit_ids;
    for (const nlohmann::json& unit : payload.at("aces")) {
        web_detail::require_object(unit, "multiACE Web ACE");
        const int unit_id = web_detail::required_index(unit, "idx", "multiACE Web ACE");
        if (!unit_ids.insert(unit_id).second)
            throw std::invalid_argument("duplicate multiACE Web ACE.idx: " + std::to_string(unit_id));
        if (!unit.contains("slots") || !unit.at("slots").is_array())
            throw std::invalid_argument("multiACE Web ACE.slots must be an array");

        const std::optional<bool>   connected   = web_detail::optional_bool(unit, "connected");
        const std::optional<int>    humidity    = web_detail::optional_bounded_integer(unit, "humidity", 0, 100);
        const std::optional<double> temperature = web_detail::optional_number(unit, "temp");
        const nlohmann::json     dryer = unit.contains("dryer") && !unit.at("dryer").is_null() ? unit.at("dryer") : nlohmann::json(nullptr);
        const DryerState         dryer_state     = web_detail::parse_dryer_state(dryer);
        const std::optional<int> dryer_remaining = web_detail::parse_dryer_remaining_minutes(dryer);

        std::set<int> slot_ids;
        for (const nlohmann::json& slot : unit.at("slots")) {
            web_detail::require_object(slot, "multiACE Web slot");
            const int slot_id = web_detail::required_index(slot, "idx", "multiACE Web slot");
            if (!slot_ids.insert(slot_id).second)
                throw std::invalid_argument("duplicate multiACE Web slot.idx in ACE " + std::to_string(unit_id) + ": " +
                                            std::to_string(slot_id));
            const std::pair<int, int> source_key{unit_id, slot_id};
            if (!source_keys.insert(source_key).second)
                throw std::invalid_argument("duplicate multiACE Web source: multiace:" + std::to_string(unit_id) + ':' +
                                            std::to_string(slot_id));

            FilamentSource source;
            source.id                      = {"multiace", std::to_string(unit_id), std::to_string(slot_id)};
            source.material                = web_detail::optional_string(slot, "material");
            source.subtype                 = web_detail::optional_string(slot, "subtype");
            source.brand                   = web_detail::optional_string(slot, "brand");
            source.color                   = web_detail::optional_string(slot, "color");
            source.metadata_origin         = web_detail::parse_metadata_origin(slot);
            source.state                   = connected && !*connected ? SourceState::Offline :
                                                                        web_detail::parse_source_state(web_detail::optional_string(slot, "state"));
            source.humidity_percent        = humidity;
            source.temperature_c           = temperature;
            source.dryer_state             = dryer_state;
            source.dryer_remaining_minutes = dryer_remaining;

            if (mode == "multi" && slot_id < PHYSICAL_TOOLHEAD_COUNT) {
                source.reachable_toolheads.emplace_back(slot_id);
            } else if (mode == "head") {
                const auto routes = head_routes.find(unit_id);
                if (routes != head_routes.end())
                    source.reachable_toolheads = routes->second;
            }

            const auto loaded = loaded_toolheads.find(source_key);
            if (loaded != loaded_toolheads.end()) {
                source.loaded_toolhead = loaded->second;
                source.reachable_toolheads.emplace_back(loaded->second);
                loaded_sources_found.insert(source_key);
            }
            std::sort(source.reachable_toolheads.begin(), source.reachable_toolheads.end());
            source.reachable_toolheads.erase(std::unique(source.reachable_toolheads.begin(), source.reachable_toolheads.end()),
                                             source.reachable_toolheads.end());

            inventory.sources.emplace_back(std::move(source));
        }
    }

    for (const auto& loaded : loaded_toolheads) {
        if (loaded_sources_found.find(loaded.first) == loaded_sources_found.end())
            throw std::invalid_argument("multiACE Web toolhead references an unknown ACE source");
    }

    std::sort(inventory.sources.begin(), inventory.sources.end(),
              [](const FilamentSource& lhs, const FilamentSource& rhs) { return lhs.id.str() < rhs.id.str(); });
    inventory.revision = web_detail::content_revision(inventory);
    return inventory;
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceWebPayload_hpp_
