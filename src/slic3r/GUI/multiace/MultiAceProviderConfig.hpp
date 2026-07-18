#ifndef slic3r_MultiAceProviderConfig_hpp_
#define slic3r_MultiAceProviderConfig_hpp_

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
    if (normalized.rfind("https://", 0) == 0)
        throw std::invalid_argument("multiACE HTTPS activation requires wss:// transport support");
    if (normalized.rfind("http://", 0) != 0)
        throw std::invalid_argument("multiACE service URL must start with http://");

    for (const unsigned char character : normalized) {
        if (character <= 0x20 || character == 0x7f)
            throw std::invalid_argument("multiACE service URL must not contain whitespace or control characters");
    }

    ProviderTransportUrls urls{normalized, "ws://" + normalized.substr(7)};
    (void) parse_websocket_endpoint(urls.websocket_base_url, "/");
    return urls;
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

    auto provider = std::make_shared<MoonrakerFilamentSourceProvider>(std::make_shared<HttpRestTransport>(std::move(http_config)),
                                                                      std::make_shared<BeastWebSocketEventTransport>(
                                                                          std::move(websocket_config)),
                                                                      MoonrakerEndpoints::multiace_web());

    if (!provider->start()) {
        const std::string error = provider->last_error();
        throw std::runtime_error(error.empty() ? "multiACE provider failed to start" : error);
    }

    return provider;
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceProviderConfig_hpp_
