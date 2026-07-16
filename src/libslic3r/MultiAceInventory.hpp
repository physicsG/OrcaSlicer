#ifndef slic3r_MultiAceInventory_hpp_
#define slic3r_MultiAceInventory_hpp_

#include "nlohmann/json.hpp"

#include <algorithm>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace Slic3r::MultiAce {

inline constexpr int SUPPORTED_SCHEMA_VERSION = 1;
inline constexpr int PHYSICAL_TOOLHEAD_COUNT  = 4;

struct SourceId
{
    std::string provider;
    std::string unit_id;
    std::string slot_id;

    std::string str() const
    {
        if (provider.empty() || unit_id.empty() || slot_id.empty())
            throw std::invalid_argument("multiACE source ID components must not be empty");
        if (provider.find(':') != std::string::npos || unit_id.find(':') != std::string::npos || slot_id.find(':') != std::string::npos)
            throw std::invalid_argument("multiACE source ID components must not contain ':'");
        return provider + ':' + unit_id + ':' + slot_id;
    }

    friend bool operator==(const SourceId& lhs, const SourceId& rhs)
    {
        return lhs.provider == rhs.provider && lhs.unit_id == rhs.unit_id && lhs.slot_id == rhs.slot_id;
    }

    friend bool operator!=(const SourceId& lhs, const SourceId& rhs) { return !(lhs == rhs); }
};

inline SourceId parse_source_id(const std::string& value)
{
    const size_t first  = value.find(':');
    const size_t second = first == std::string::npos ? std::string::npos : value.find(':', first + 1);
    if (first == std::string::npos || second == std::string::npos || value.find(':', second + 1) != std::string::npos)
        throw std::invalid_argument("multiACE source ID must use provider:unit:slot format");

    SourceId result{value.substr(0, first), value.substr(first + 1, second - first - 1), value.substr(second + 1)};
    (void) result.str();
    return result;
}

enum class SourceMetadataOrigin {
    Unknown,
    RFID,
    Manual,
    Derived,
    Profile,
};

enum class SourceState {
    Unknown,
    Empty,
    Ready,
    Loading,
    Unloading,
    Error,
    Offline,
};

enum class DryerState {
    Unknown,
    Off,
    Drying,
    Complete,
    Error,
};

struct ProviderCapabilities
{
    int  schema_version         = SUPPORTED_SCHEMA_VERSION;
    bool inventory              = false;
    bool live_events            = false;
    bool rfid_refresh           = false;
    bool remaining_percent      = false;
    bool dryer_state            = false;
    bool per_source_routing     = false;
    bool measured_change_timing = false;
};

struct FilamentSource
{
    SourceId id;

    std::string rfid_uid;
    std::string material;
    std::string subtype;
    std::string brand;
    std::string color;

    std::optional<int>   remaining_percent;
    SourceMetadataOrigin metadata_origin = SourceMetadataOrigin::Unknown;
    SourceState          state           = SourceState::Unknown;

    std::vector<int>   reachable_toolheads;
    std::optional<int> loaded_toolhead;

    std::optional<int>    humidity_percent;
    std::optional<double> temperature_c;
    DryerState            dryer_state = DryerState::Unknown;
    std::optional<int>    dryer_remaining_minutes;
};

struct InventorySnapshot
{
    int                         schema_version = SUPPORTED_SCHEMA_VERSION;
    std::string                 revision;
    std::vector<FilamentSource> sources;
};

namespace detail {

inline void require_object(const nlohmann::json& value, const std::string& name)
{
    if (!value.is_object())
        throw std::invalid_argument(name + " must be a JSON object");
}

inline int parse_schema_version(const nlohmann::json& value)
{
    if (!value.contains("schema_version") || !value.at("schema_version").is_number_integer())
        throw std::invalid_argument("schema_version must be an integer");
    const int schema_version = value.at("schema_version").get<int>();
    if (schema_version != SUPPORTED_SCHEMA_VERSION)
        throw std::invalid_argument("unsupported multiACE schema_version: " + std::to_string(schema_version));
    return schema_version;
}

inline std::string required_id_component(const nlohmann::json& source, const char* field)
{
    if (!source.contains(field))
        throw std::invalid_argument(std::string("source.") + field + " is required");

    const nlohmann::json& value = source.at(field);
    std::string           result;
    if (value.is_string())
        result = value.get<std::string>();
    else if (value.is_number_integer())
        result = std::to_string(value.get<long long>());
    else
        throw std::invalid_argument(std::string("source.") + field + " must be a string or integer");

    if (result.empty())
        throw std::invalid_argument(std::string("source.") + field + " must not be empty");
    if (result.find(':') != std::string::npos)
        throw std::invalid_argument(std::string("source.") + field + " must not contain ':'");
    return result;
}

inline std::string optional_string(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return {};
    if (!object.at(field).is_string())
        throw std::invalid_argument(std::string(field) + " must be a string");
    return object.at(field).get<std::string>();
}

inline std::optional<int> optional_bounded_integer(const nlohmann::json& object, const char* field, int minimum, int maximum)
{
    if (!object.contains(field) || object.at(field).is_null())
        return std::nullopt;
    if (!object.at(field).is_number_integer())
        throw std::invalid_argument(std::string(field) + " must be an integer or null");
    const int value = object.at(field).get<int>();
    if (value < minimum || value > maximum)
        throw std::invalid_argument(std::string(field) + " is outside the supported range");
    return value;
}

inline std::optional<double> optional_number(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return std::nullopt;
    if (!object.at(field).is_number())
        throw std::invalid_argument(std::string(field) + " must be numeric or null");
    return object.at(field).get<double>();
}

inline bool optional_bool(const nlohmann::json& object, const char* field)
{
    if (!object.contains(field) || object.at(field).is_null())
        return false;
    if (!object.at(field).is_boolean())
        throw std::invalid_argument(std::string(field) + " must be a boolean");
    return object.at(field).get<bool>();
}

inline SourceMetadataOrigin parse_metadata_origin(const std::string& value)
{
    if (value == "rfid")
        return SourceMetadataOrigin::RFID;
    if (value == "manual")
        return SourceMetadataOrigin::Manual;
    if (value == "derived")
        return SourceMetadataOrigin::Derived;
    if (value == "profile")
        return SourceMetadataOrigin::Profile;
    return SourceMetadataOrigin::Unknown;
}

inline SourceState parse_source_state(const std::string& value)
{
    if (value == "empty")
        return SourceState::Empty;
    if (value == "ready")
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

inline DryerState parse_dryer_state(const nlohmann::json& source)
{
    if (source.contains("dryer_state") && !source.at("dryer_state").is_null()) {
        if (!source.at("dryer_state").is_string())
            throw std::invalid_argument("dryer_state must be a string or null");
        const std::string value = source.at("dryer_state").get<std::string>();
        if (value == "off")
            return DryerState::Off;
        if (value == "drying")
            return DryerState::Drying;
        if (value == "complete")
            return DryerState::Complete;
        if (value == "error")
            return DryerState::Error;
        return DryerState::Unknown;
    }

    if (source.contains("dryer_active") && !source.at("dryer_active").is_null()) {
        if (!source.at("dryer_active").is_boolean())
            throw std::invalid_argument("dryer_active must be a boolean or null");
        return source.at("dryer_active").get<bool>() ? DryerState::Drying : DryerState::Off;
    }

    return DryerState::Unknown;
}

inline std::vector<int> parse_reachable_toolheads(const nlohmann::json& source)
{
    if (!source.contains("reachable_toolheads") || source.at("reachable_toolheads").is_null())
        return {};
    if (!source.at("reachable_toolheads").is_array())
        throw std::invalid_argument("reachable_toolheads must be an array");

    std::set<int> unique;
    for (const nlohmann::json& value : source.at("reachable_toolheads")) {
        if (!value.is_number_integer())
            throw std::invalid_argument("reachable_toolheads entries must be integers");
        const int toolhead = value.get<int>();
        if (toolhead < 0 || toolhead >= PHYSICAL_TOOLHEAD_COUNT)
            throw std::invalid_argument("reachable_toolheads contains an invalid U1 toolhead");
        unique.insert(toolhead);
    }
    return {unique.begin(), unique.end()};
}

} // namespace detail

inline ProviderCapabilities parse_capabilities(const nlohmann::json& payload)
{
    detail::require_object(payload, "multiACE capabilities payload");

    ProviderCapabilities  result;
    const nlohmann::json* capabilities = &payload;
    if (payload.contains("schema_version"))
        result.schema_version = detail::parse_schema_version(payload);
    if (payload.contains("capabilities")) {
        if (!payload.at("capabilities").is_object())
            throw std::invalid_argument("capabilities must be a JSON object");
        capabilities = &payload.at("capabilities");
    }

    result.inventory              = detail::optional_bool(*capabilities, "inventory");
    result.live_events            = detail::optional_bool(*capabilities, "live_events");
    result.rfid_refresh           = detail::optional_bool(*capabilities, "rfid_refresh");
    result.remaining_percent      = detail::optional_bool(*capabilities, "remaining_percent");
    result.dryer_state            = detail::optional_bool(*capabilities, "dryer_state");
    result.per_source_routing     = detail::optional_bool(*capabilities, "per_source_routing");
    result.measured_change_timing = detail::optional_bool(*capabilities, "measured_change_timing");
    return result;
}

inline InventorySnapshot parse_inventory(const nlohmann::json& payload)
{
    detail::require_object(payload, "multiACE inventory payload");

    InventorySnapshot result;
    result.schema_version = detail::parse_schema_version(payload);
    result.revision       = detail::optional_string(payload, "revision");
    if (result.revision.empty())
        throw std::invalid_argument("revision is required and must not be empty");
    if (!payload.contains("sources") || !payload.at("sources").is_array())
        throw std::invalid_argument("sources must be an array");

    std::set<std::string> seen_ids;
    for (const nlohmann::json& source_json : payload.at("sources")) {
        detail::require_object(source_json, "multiACE inventory source");

        const std::string unit_id = detail::required_id_component(source_json, "unit_id");
        const std::string slot_id = detail::required_id_component(source_json, "slot_id");
        const SourceId    canonical_id{"multiace", unit_id, slot_id};

        SourceId source_id = canonical_id;
        if (source_json.contains("source_id") && !source_json.at("source_id").is_null()) {
            if (!source_json.at("source_id").is_string())
                throw std::invalid_argument("source_id must be a string or null");
            source_id = parse_source_id(source_json.at("source_id").get<std::string>());
            if (source_id != canonical_id)
                throw std::invalid_argument("source_id does not match unit_id and slot_id");
        }

        const std::string source_key = source_id.str();
        if (!seen_ids.insert(source_key).second)
            throw std::invalid_argument("duplicate multiACE source_id: " + source_key);

        FilamentSource source;
        source.id       = std::move(source_id);
        source.rfid_uid = detail::optional_string(source_json, "rfid_uid");
        if (source.rfid_uid.empty())
            source.rfid_uid = detail::optional_string(source_json, "tag_uid");
        source.material                = detail::optional_string(source_json, "material");
        source.subtype                 = detail::optional_string(source_json, "subtype");
        source.brand                   = detail::optional_string(source_json, "brand");
        source.color                   = detail::optional_string(source_json, "color");
        source.remaining_percent       = detail::optional_bounded_integer(source_json, "remaining_percent", 0, 100);
        source.metadata_origin         = detail::parse_metadata_origin(detail::optional_string(source_json, "metadata_origin"));
        source.state                   = detail::parse_source_state(detail::optional_string(source_json, "state"));
        source.reachable_toolheads     = detail::parse_reachable_toolheads(source_json);
        source.loaded_toolhead         = detail::optional_bounded_integer(source_json, "loaded_toolhead", 0, PHYSICAL_TOOLHEAD_COUNT - 1);
        source.humidity_percent        = detail::optional_bounded_integer(source_json, "humidity_percent", 0, 100);
        source.temperature_c           = detail::optional_number(source_json, "temperature_c");
        source.dryer_state             = detail::parse_dryer_state(source_json);
        source.dryer_remaining_minutes = detail::optional_bounded_integer(source_json, "dryer_remaining_minutes", 0, 24 * 60);

        result.sources.emplace_back(std::move(source));
    }

    return result;
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceInventory_hpp_
