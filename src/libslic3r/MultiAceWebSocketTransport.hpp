#ifndef slic3r_MultiAceWebSocketTransport_hpp_
#define slic3r_MultiAceWebSocketTransport_hpp_

#include "MultiAceTransport.hpp"

#include <chrono>
#include <cstddef>
#include <map>
#include <memory>
#include <string>

namespace Slic3r::MultiAce {

struct WebSocketEventTransportConfig
{
    std::string                        base_url;
    std::string                        username;
    std::string                        password;
    std::string                        bearer_token;
    std::map<std::string, std::string> headers;
    std::chrono::milliseconds          handshake_timeout{5000};
    std::chrono::milliseconds          reconnect_initial_delay{250};
    std::chrono::milliseconds          reconnect_max_delay{10000};
    std::size_t                        max_message_size = 2 * 1024 * 1024;
};

struct WebSocketEndpoint
{
    std::string host;
    std::string port;
    std::string target;
    std::string host_header;
};

WebSocketEndpoint parse_websocket_endpoint(const std::string& base_url, const std::string& path);

std::chrono::milliseconds websocket_reconnect_delay(std::chrono::milliseconds initial_delay,
                                                     std::chrono::milliseconds maximum_delay,
                                                     std::size_t               retry_index);

class BeastWebSocketEventTransport final : public EventTransport
{
public:
    explicit BeastWebSocketEventTransport(WebSocketEventTransportConfig config);
    ~BeastWebSocketEventTransport() override;

    BeastWebSocketEventTransport(const BeastWebSocketEventTransport&)            = delete;
    BeastWebSocketEventTransport& operator=(const BeastWebSocketEventTransport&) = delete;
    BeastWebSocketEventTransport(BeastWebSocketEventTransport&&)                 = delete;
    BeastWebSocketEventTransport& operator=(BeastWebSocketEventTransport&&)      = delete;

    void connect(const std::string& path, EventCallback event_callback, ConnectionCallback connection_callback) override;
    void disconnect() override;

    bool running() const;

private:
    class State;

    WebSocketEventTransportConfig m_config;
    std::shared_ptr<State>         m_state;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceWebSocketTransport_hpp_
