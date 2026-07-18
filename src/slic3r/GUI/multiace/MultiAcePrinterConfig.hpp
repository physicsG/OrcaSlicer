#ifndef slic3r_MultiAcePrinterConfig_hpp_
#define slic3r_MultiAcePrinterConfig_hpp_

#include "MultiAceProviderConfig.hpp"

#include "nlohmann/json.hpp"

#include <optional>
#include <stdexcept>
#include <string>

namespace Slic3r::MultiAce {

struct PersistedProviderConfig
{
    static constexpr int CURRENT_VERSION = 1;

    bool                     enabled = false;
    ProviderActivationConfig activation;
};

inline void validate_persisted_provider_config(const PersistedProviderConfig& config)
{
    if (config.activation.username.empty() != config.activation.password.empty())
        throw std::invalid_argument("multiACE basic authentication requires both username and password");

    for (const auto &[name, value] : config.activation.headers) {
        (void) value;
        if (name.empty())
            throw std::invalid_argument("multiACE custom header names must not be empty");
    }

    if (config.enabled) {
        if (config.activation.service_url.empty())
            throw std::invalid_argument("enabled multiACE configuration requires a service URL");
        (void) provider_transport_urls(config.activation.service_url);
    }
}

inline nlohmann::json serialize_persisted_provider_config(const PersistedProviderConfig& config)
{
    validate_persisted_provider_config(config);

    nlohmann::json result = {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", config.enabled},
    };

    if (!config.activation.service_url.empty())
        result["service_url"] = config.activation.service_url;

    nlohmann::json auth = nlohmann::json::object();
    if (!config.activation.username.empty()) {
        auth["username"] = config.activation.username;
        auth["password"] = config.activation.password;
    }
    if (!config.activation.bearer_token.empty())
        auth["bearer_token"] = config.activation.bearer_token;
    if (!auth.empty())
        result["auth"] = std::move(auth);

    if (!config.activation.headers.empty())
        result["headers"] = config.activation.headers;

    return result;
}

inline PersistedProviderConfig parse_persisted_provider_config(const nlohmann::json& value)
{
    if (!value.is_object())
        throw std::invalid_argument("multiACE persisted configuration must be a JSON object");

    const auto version_it = value.find("version");
    if (version_it == value.end() || !version_it->is_number_integer())
        throw std::invalid_argument("multiACE persisted configuration requires an integer version");

    const int version = version_it->get<int>();
    if (version != PersistedProviderConfig::CURRENT_VERSION)
        throw std::invalid_argument("unsupported multiACE persisted configuration version");

    PersistedProviderConfig config;

    if (const auto it = value.find("enabled"); it != value.end()) {
        if (!it->is_boolean())
            throw std::invalid_argument("multiACE persisted enabled flag must be boolean");
        config.enabled = it->get<bool>();
    }

    if (const auto it = value.find("service_url"); it != value.end()) {
        if (!it->is_string())
            throw std::invalid_argument("multiACE persisted service URL must be a string");
        config.activation.service_url = it->get<std::string>();
    }

    if (const auto auth_it = value.find("auth"); auth_it != value.end()) {
        if (!auth_it->is_object())
            throw std::invalid_argument("multiACE persisted auth must be a JSON object");

        auto read_auth_string = [&auth_it](const char* key, std::string& target) {
            if (const auto it = auth_it->find(key); it != auth_it->end()) {
                if (!it->is_string())
                    throw std::invalid_argument(std::string("multiACE persisted auth field must be a string: ") + key);
                target = it->get<std::string>();
            }
        };

        read_auth_string("username", config.activation.username);
        read_auth_string("password", config.activation.password);
        read_auth_string("bearer_token", config.activation.bearer_token);
    }

    if (const auto headers_it = value.find("headers"); headers_it != value.end()) {
        if (!headers_it->is_object())
            throw std::invalid_argument("multiACE persisted headers must be a JSON object");

        for (auto it = headers_it->begin(); it != headers_it->end(); ++it) {
            if (!it.value().is_string())
                throw std::invalid_argument("multiACE persisted header values must be strings");
            config.activation.headers.emplace(it.key(), it.value().get<std::string>());
        }
    }

    validate_persisted_provider_config(config);
    return config;
}

inline std::optional<ProviderActivationConfig> provider_activation_config_if_enabled(const PersistedProviderConfig& config)
{
    validate_persisted_provider_config(config);
    if (!config.enabled)
        return std::nullopt;
    return config.activation;
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAcePrinterConfig_hpp_
