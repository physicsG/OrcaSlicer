#ifndef slic3r_MultiAceProviderActivation_hpp_
#define slic3r_MultiAceProviderActivation_hpp_

#include "../DeviceManager.hpp"
#include "MultiAceHttpTransport.hpp"
#include "libslic3r/MoonrakerFilamentSourceProvider.hpp"
#include "libslic3r/MultiAceWebSocketTransport.hpp"

#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

struct ProviderActivationConfig
{
    std::string                        service_url;
    std::string                        username;
    std::string                        password;
    std::string                        bearer_token;
    std::map<std::string, std::string> headers;
};

struct ProviderTransportUrls
{
    std::string http_base_url;
    std::string websocket_base_url;
};

inline std::string trim_trailing_slashes(std::string value)
{
    while (value.size() > 1 && value.back() == '/')
        value.pop_back();
    return value;
}

inline ProviderTransportUrls provider_transport_urls(const std::string& service_url)
{
    const std::string normalized = trim_trailing_slashes(service_url);
    if (normalized.rfind("http://", 0) == 0)
        return {normalized, "ws://" + normalized.substr(7)};
    if (normalized.rfind("https://", 0) == 0)
        throw std::invalid_argument("multiACE HTTPS activation requires wss:// transport support");
    throw std::invalid_argument("multiACE service URL must start with http://");
}

inline std::shared_ptr<MoonrakerFilamentSourceProvider> create_started_multiace_web_provider(const ProviderActivationConfig& config)
{
    const ProviderTransportUrls urls = provider_transport_urls(config.service_url);

    HttpTransportConfig http_config;
    http_config.base_url     = urls.http_base_url;
    http_config.username     = config.username;
    http_config.password     = config.password;
    http_config.bearer_token = config.bearer_token;
    http_config.headers      = config.headers;

    WebSocketEventTransportConfig websocket_config;
    websocket_config.base_url     = urls.websocket_base_url;
    websocket_config.username     = config.username;
    websocket_config.password     = config.password;
    websocket_config.bearer_token = config.bearer_token;
    websocket_config.headers      = config.headers;

    auto provider = std::make_shared<MoonrakerFilamentSourceProvider>(
        std::make_shared<HttpRestTransport>(std::move(http_config)),
        std::make_shared<BeastWebSocketEventTransport>(std::move(websocket_config)),
        MoonrakerEndpoints::multiace_web());

    if (!provider->start()) {
        const std::string error = provider->last_error();
        throw std::runtime_error(error.empty() ? "multiACE provider failed to start" : error);
    }

    return provider;
}

inline MultiAceMachineBinding& activate_multiace_web_provider(DeviceManager&                   device_manager,
                                                               MachineObject&                    machine,
                                                               const ProviderActivationConfig&   config,
                                                               DeviceManager::MultiAceDispatcher dispatcher = {})
{
    auto provider = create_started_multiace_web_provider(config);
    try {
        return device_manager.attach_multiace_provider(machine, provider, std::move(dispatcher));
    } catch (...) {
        provider->stop();
        throw;
    }
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceProviderActivation_hpp_
