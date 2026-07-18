#ifndef slic3r_MultiAceWebSocketTransport_ipp_
#define slic3r_MultiAceWebSocketTransport_ipp_

#include <boost/asio/executor_work_guard.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/websocket.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <limits>
#include <optional>
#include <stdexcept>
#include <thread>
#include <utility>

namespace Slic3r::MultiAce {
namespace websocket_detail {

namespace asio      = boost::asio;
namespace beast     = boost::beast;
namespace http      = beast::http;
namespace websocket = beast::websocket;
using tcp           = asio::ip::tcp;
using ErrorCode     = boost::system::error_code;
using WebSocket     = websocket::stream<beast::tcp_stream>;

inline bool starts_with(const std::string& value, const char* prefix)
{
    return value.rfind(prefix, 0) == 0;
}

inline bool equals_ascii_case_insensitive(const std::string& lhs, const char* rhs)
{
    const std::string rhs_string(rhs);
    if (lhs.size() != rhs_string.size())
        return false;
    return std::equal(lhs.begin(), lhs.end(), rhs_string.begin(), [](unsigned char left, unsigned char right) {
        return std::tolower(left) == std::tolower(right);
    });
}

inline unsigned parse_port(const std::string& port)
{
    if (port.empty())
        throw std::invalid_argument("multiACE WebSocket port must not be empty");

    unsigned value = 0;
    for (const unsigned char character : port) {
        if (!std::isdigit(character))
            throw std::invalid_argument("multiACE WebSocket port must be numeric");
        const unsigned digit = character - '0';
        if (value > (65535U - digit) / 10U)
            throw std::invalid_argument("multiACE WebSocket port is outside the supported range");
        value = value * 10U + digit;
    }
    if (value == 0)
        throw std::invalid_argument("multiACE WebSocket port is outside the supported range");
    return value;
}

inline std::string base64_encode(const std::string& value)
{
    static constexpr char ALPHABET[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    std::string result;
    result.reserve(((value.size() + 2) / 3) * 4);
    std::size_t offset = 0;
    while (offset + 3 <= value.size()) {
        const std::uint32_t block = (static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset])) << 16U) |
                                    (static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset + 1])) << 8U) |
                                    static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset + 2]));
        result.push_back(ALPHABET[(block >> 18U) & 0x3FU]);
        result.push_back(ALPHABET[(block >> 12U) & 0x3FU]);
        result.push_back(ALPHABET[(block >> 6U) & 0x3FU]);
        result.push_back(ALPHABET[block & 0x3FU]);
        offset += 3;
    }

    const std::size_t remaining = value.size() - offset;
    if (remaining == 1) {
        const std::uint32_t block = static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset])) << 16U;
        result.push_back(ALPHABET[(block >> 18U) & 0x3FU]);
        result.push_back(ALPHABET[(block >> 12U) & 0x3FU]);
        result += "==";
    } else if (remaining == 2) {
        const std::uint32_t block = (static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset])) << 16U) |
                                    (static_cast<std::uint32_t>(static_cast<unsigned char>(value[offset + 1])) << 8U);
        result.push_back(ALPHABET[(block >> 18U) & 0x3FU]);
        result.push_back(ALPHABET[(block >> 12U) & 0x3FU]);
        result.push_back(ALPHABET[(block >> 6U) & 0x3FU]);
        result.push_back('=');
    }
    return result;
}

inline void validate_header(const std::string& name, const std::string& value)
{
    if (name.empty())
        throw std::invalid_argument("multiACE WebSocket header name must not be empty");
    if (name.find_first_of("\r\n:") != std::string::npos || value.find_first_of("\r\n") != std::string::npos)
        throw std::invalid_argument("multiACE WebSocket headers must not contain control separators");
}

inline void validate_config(const WebSocketEventTransportConfig& config)
{
    if (config.base_url.empty())
        throw std::invalid_argument("multiACE WebSocket base URL is required");
    if (!config.password.empty() && config.username.empty())
        throw std::invalid_argument("multiACE WebSocket basic-auth password requires a username");
    if (!config.username.empty() && !config.bearer_token.empty())
        throw std::invalid_argument("multiACE WebSocket basic and bearer authentication are mutually exclusive");
    if (config.handshake_timeout.count() <= 0)
        throw std::invalid_argument("multiACE WebSocket handshake timeout must be positive");
    if (config.reconnect_initial_delay.count() <= 0 || config.reconnect_max_delay.count() <= 0)
        throw std::invalid_argument("multiACE WebSocket reconnect delays must be positive");
    if (config.reconnect_initial_delay > config.reconnect_max_delay)
        throw std::invalid_argument("multiACE WebSocket initial reconnect delay must not exceed the maximum");
    if (config.max_message_size == 0)
        throw std::invalid_argument("multiACE WebSocket maximum message size must be positive");

    for (const auto& [name, value] : config.headers) {
        validate_header(name, value);
        if ((!config.username.empty() || !config.bearer_token.empty()) && equals_ascii_case_insensitive(name, "Authorization"))
            throw std::invalid_argument("multiACE WebSocket Authorization header conflicts with configured authentication");
    }
}

inline std::string join_target(std::string base_path, std::string path)
{
    if (path.empty())
        throw std::invalid_argument("multiACE WebSocket event path must not be empty");
    if (starts_with(path, "ws://") || starts_with(path, "wss://"))
        throw std::invalid_argument("multiACE WebSocket event path must be relative to the configured base URL");
    if (path.find('#') != std::string::npos)
        throw std::invalid_argument("multiACE WebSocket event path must not contain a fragment");

    while (!base_path.empty() && base_path.back() == '/')
        base_path.pop_back();
    if (path.front() != '/')
        path.insert(path.begin(), '/');

    std::string target = base_path + path;
    if (target.empty() || target.front() != '/')
        target.insert(target.begin(), '/');
    return target;
}

} // namespace websocket_detail

inline WebSocketEndpoint parse_websocket_endpoint(const std::string& base_url, const std::string& path)
{
    using namespace websocket_detail;

    if (starts_with(base_url, "wss://"))
        throw std::invalid_argument("multiACE WebSocket TLS (wss://) is not supported yet");
    if (!starts_with(base_url, "ws://"))
        throw std::invalid_argument("multiACE WebSocket base URL must start with ws://");

    const std::string remainder = base_url.substr(5);
    if (remainder.empty())
        throw std::invalid_argument("multiACE WebSocket base URL must contain a host");
    if (remainder.find('#') != std::string::npos || remainder.find('?') != std::string::npos)
        throw std::invalid_argument("multiACE WebSocket base URL must not contain a query or fragment");

    const std::size_t path_begin = remainder.find('/');
    const std::string authority  = remainder.substr(0, path_begin);
    std::string       base_path  = path_begin == std::string::npos ? std::string{} : remainder.substr(path_begin);
    if (authority.empty())
        throw std::invalid_argument("multiACE WebSocket base URL must contain a host");
    if (authority.find('@') != std::string::npos)
        throw std::invalid_argument("multiACE WebSocket credentials must be configured separately from the URL");

    std::string host;
    std::string port = "80";
    bool        ipv6 = false;
    if (authority.front() == '[') {
        const std::size_t close_bracket = authority.find(']');
        if (close_bracket == std::string::npos || close_bracket == 1)
            throw std::invalid_argument("multiACE WebSocket IPv6 host is malformed");
        host = authority.substr(1, close_bracket - 1);
        ipv6 = true;
        if (close_bracket + 1 < authority.size()) {
            if (authority[close_bracket + 1] != ':')
                throw std::invalid_argument("multiACE WebSocket authority is malformed");
            port = authority.substr(close_bracket + 2);
        }
    } else {
        const std::size_t colon = authority.rfind(':');
        if (colon != std::string::npos) {
            if (authority.find(':') != colon)
                throw std::invalid_argument("multiACE WebSocket IPv6 hosts must use brackets");
            host = authority.substr(0, colon);
            port = authority.substr(colon + 1);
        } else {
            host = authority;
        }
    }

    if (host.empty())
        throw std::invalid_argument("multiACE WebSocket base URL must contain a host");
    const unsigned port_number = parse_port(port);

    WebSocketEndpoint endpoint;
    endpoint.host        = std::move(host);
    endpoint.port        = std::to_string(port_number);
    endpoint.target      = join_target(std::move(base_path), path);
    endpoint.host_header = ipv6 ? '[' + endpoint.host + ']' : endpoint.host;
    if (port_number != 80)
        endpoint.host_header += ':' + endpoint.port;
    return endpoint;
}

inline std::chrono::milliseconds websocket_reconnect_delay(std::chrono::milliseconds initial_delay,
                                                            std::chrono::milliseconds maximum_delay,
                                                            std::size_t               retry_index)
{
    if (initial_delay.count() <= 0 || maximum_delay.count() <= 0 || initial_delay > maximum_delay)
        throw std::invalid_argument("multiACE WebSocket reconnect delay bounds are invalid");

    auto delay = initial_delay;
    while (retry_index-- > 0 && delay < maximum_delay) {
        if (delay.count() > maximum_delay.count() / 2) {
            delay = maximum_delay;
        } else {
            delay *= 2;
            if (delay > maximum_delay)
                delay = maximum_delay;
        }
    }
    return delay;
}

class BeastWebSocketEventTransport::State : public std::enable_shared_from_this<BeastWebSocketEventTransport::State>
{
public:
    State(WebSocketEventTransportConfig config,
          WebSocketEndpoint             endpoint,
          EventCallback                 event_callback,
          ConnectionCallback            connection_callback)
        : m_config(std::move(config))
        , m_endpoint(std::move(endpoint))
        , m_event_callback(std::move(event_callback))
        , m_connection_callback(std::move(connection_callback))
        , m_work_guard(websocket_detail::asio::make_work_guard(m_io))
        , m_resolver(m_io)
        , m_reconnect_timer(m_io)
    {}

    ~State()
    {
        if (m_worker.joinable()) {
            if (m_worker.get_id() == std::this_thread::get_id())
                m_worker.detach();
            else
                m_worker.join();
        }
    }

    void start()
    {
        std::lock_guard<std::mutex> lock(m_lifecycle_mutex);
        if (m_started || m_stopping)
            return;

        m_started = true;
        m_running = true;
        const std::shared_ptr<State> self = shared_from_this();
        m_worker = std::thread([self] { self->run(); });
        websocket_detail::asio::post(m_io, [self] { self->begin_attempt(); });
    }

    void stop()
    {
        bool stop_on_worker = false;
        {
            std::lock_guard<std::mutex> lock(m_lifecycle_mutex);
            m_stopping = true;
            if (!m_started || m_stop_started)
                return;
            m_stop_started = true;
            stop_on_worker = m_worker.joinable() && m_worker.get_id() == std::this_thread::get_id();
            if (!stop_on_worker) {
                const std::shared_ptr<State> self = shared_from_this();
                websocket_detail::asio::post(m_io, [self] { self->stop_on_io(); });
            }
        }

        if (stop_on_worker) {
            stop_on_io();
            if (m_worker.joinable())
                m_worker.detach();
        } else if (m_worker.joinable()) {
            m_worker.join();
        }
    }

    bool running() const { return m_running.load(); }

private:
    void run()
    {
        try {
            m_io.run();
        } catch (const std::exception& error) {
            report_connection(false, std::string("multiACE WebSocket worker failed: ") + error.what());
        } catch (...) {
            report_connection(false, "multiACE WebSocket worker failed with an unknown error");
        }
        m_running = false;
    }

    void begin_attempt()
    {
        using namespace websocket_detail;
        if (m_stopping)
            return;

        m_buffer.consume(m_buffer.size());
        m_socket = std::make_unique<WebSocket>(m_io);
        beast::get_lowest_layer(*m_socket).expires_after(m_config.handshake_timeout);

        const std::shared_ptr<State> self = shared_from_this();
        m_resolver.async_resolve(m_endpoint.host, m_endpoint.port, [self](const ErrorCode& error, const tcp::resolver::results_type& results) {
            if (error)
                return self->fail_and_reconnect("resolve", error);
            self->on_resolved(results);
        });
    }

    void on_resolved(const websocket_detail::tcp::resolver::results_type& results)
    {
        using namespace websocket_detail;
        if (m_stopping || !m_socket)
            return;

        const std::shared_ptr<State> self = shared_from_this();
        beast::get_lowest_layer(*m_socket).async_connect(results, [self](const ErrorCode& error, const tcp::resolver::results_type::endpoint_type&) {
            if (error)
                return self->fail_and_reconnect("connect", error);
            self->on_connected();
        });
    }

    void on_connected()
    {
        using namespace websocket_detail;
        if (m_stopping || !m_socket)
            return;

        beast::get_lowest_layer(*m_socket).expires_never();
        websocket::stream_base::timeout timeout = websocket::stream_base::timeout::suggested(beast::role_type::client);
        timeout.handshake_timeout                = m_config.handshake_timeout;
        m_socket->set_option(timeout);
        m_socket->read_message_max(m_config.max_message_size);

        const WebSocketEventTransportConfig config = m_config;
        m_socket->set_option(websocket::stream_base::decorator([config](websocket::request_type& request) {
            request.set(http::field::user_agent, "Snapmaker-Orca multiACE");
            for (const auto& [name, value] : config.headers)
                request.set(name, value);
            if (!config.username.empty())
                request.set(http::field::authorization, "Basic " + base64_encode(config.username + ':' + config.password));
            else if (!config.bearer_token.empty())
                request.set(http::field::authorization, "Bearer " + config.bearer_token);
        }));

        const std::shared_ptr<State> self = shared_from_this();
        m_socket->async_handshake(m_endpoint.host_header, m_endpoint.target, [self](const ErrorCode& error) {
            if (error)
                return self->fail_and_reconnect("handshake", error);
            self->on_handshake();
        });
    }

    void on_handshake()
    {
        if (m_stopping || !m_socket)
            return;

        m_retry_index = 0;
        report_connection(true, {});
        if (!m_stopping)
            begin_read();
    }

    void begin_read()
    {
        using namespace websocket_detail;
        if (m_stopping || !m_socket)
            return;

        const std::shared_ptr<State> self = shared_from_this();
        m_socket->async_read(m_buffer, [self](const ErrorCode& error, std::size_t) {
            if (error)
                return self->fail_and_reconnect("read", error);
            self->on_read();
        });
    }

    void on_read()
    {
        using namespace websocket_detail;
        if (m_stopping || !m_socket)
            return;

        if (m_socket->got_text()) {
            const std::string message = beast::buffers_to_string(m_buffer.data());
            invoke_event(message);
        }
        m_buffer.consume(m_buffer.size());
        if (!m_stopping)
            begin_read();
    }

    void fail_and_reconnect(const char* operation, const websocket_detail::ErrorCode& error)
    {
        using namespace websocket_detail;
        if (m_stopping)
            return;

        close_socket(true);
        report_connection(false, std::string("multiACE WebSocket ") + operation + " failed: " + error.message());
        if (m_stopping)
            return;

        const std::chrono::milliseconds delay =
            websocket_reconnect_delay(m_config.reconnect_initial_delay, m_config.reconnect_max_delay, m_retry_index);
        if (m_retry_index < std::numeric_limits<std::size_t>::max())
            ++m_retry_index;

        m_reconnect_timer.expires_after(delay);
        const std::shared_ptr<State> self = shared_from_this();
        m_reconnect_timer.async_wait([self](const ErrorCode& timer_error) {
            if (timer_error == asio::error::operation_aborted || self->m_stopping)
                return;
            if (timer_error)
                return self->fail_and_reconnect("reconnect timer", timer_error);
            self->begin_attempt();
        });
    }

    void stop_on_io()
    {
        using namespace websocket_detail;
        m_resolver.cancel();
        ErrorCode ignored;
        m_reconnect_timer.cancel(ignored);
        close_socket(false);
        report_connection(false, {});
        m_event_callback      = {};
        m_connection_callback = {};
        m_work_guard.reset();
        m_io.stop();
        m_running = false;
    }

    void close_socket(bool release_socket)
    {
        using namespace websocket_detail;
        if (!m_socket)
            return;
        ErrorCode ignored;
        beast::get_lowest_layer(*m_socket).socket().cancel(ignored);
        beast::get_lowest_layer(*m_socket).socket().shutdown(tcp::socket::shutdown_both, ignored);
        beast::get_lowest_layer(*m_socket).socket().close(ignored);
        if (release_socket)
            m_socket.reset();
    }

    void invoke_event(const std::string& message)
    {
        if (m_stopping || !m_event_callback)
            return;
        try {
            m_event_callback(message);
        } catch (...) {}
    }

    void report_connection(bool connected, const std::string& error)
    {
        if (m_stopping && connected)
            return;
        if (m_reported_connection.has_value() && *m_reported_connection == connected)
            return;

        m_reported_connection = connected;
        if (!m_connection_callback)
            return;
        try {
            m_connection_callback(connected, error);
        } catch (...) {}
    }

    WebSocketEventTransportConfig m_config;
    WebSocketEndpoint             m_endpoint;
    EventCallback                 m_event_callback;
    ConnectionCallback            m_connection_callback;

    websocket_detail::asio::io_context                                                     m_io;
    websocket_detail::asio::executor_work_guard<websocket_detail::asio::io_context::executor_type> m_work_guard;
    websocket_detail::tcp::resolver                                                         m_resolver;
    websocket_detail::asio::steady_timer                                                    m_reconnect_timer;
    std::unique_ptr<websocket_detail::WebSocket>                                            m_socket;
    websocket_detail::beast::flat_buffer                                                    m_buffer;
    std::thread                                                                             m_worker;
    mutable std::mutex                                                                      m_lifecycle_mutex;
    bool                                                                                    m_started      = false;
    bool                                                                                    m_stop_started = false;
    std::atomic<bool>                                                                       m_running{false};
    std::atomic<bool>                                                                       m_stopping{false};
    std::optional<bool>                                                                     m_reported_connection;
    std::size_t                                                                             m_retry_index = 0;
};

inline BeastWebSocketEventTransport::BeastWebSocketEventTransport(WebSocketEventTransportConfig config) : m_config(std::move(config))
{
    websocket_detail::validate_config(m_config);
    (void) parse_websocket_endpoint(m_config.base_url, "/");
}

inline BeastWebSocketEventTransport::~BeastWebSocketEventTransport()
{
    disconnect();
}

inline void BeastWebSocketEventTransport::connect(const std::string& path,
                                                   EventCallback      event_callback,
                                                   ConnectionCallback connection_callback)
{
    if (!event_callback)
        throw std::invalid_argument("multiACE WebSocket event callback is required");
    if (!connection_callback)
        throw std::invalid_argument("multiACE WebSocket connection callback is required");

    const WebSocketEndpoint endpoint = parse_websocket_endpoint(m_config.base_url, path);
    auto state = std::make_shared<State>(m_config, endpoint, std::move(event_callback), std::move(connection_callback));

    std::shared_ptr<State> previous;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        previous = std::exchange(m_state, state);
    }
    if (previous)
        previous->stop();

    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_state == state)
        state->start();
}

inline void BeastWebSocketEventTransport::disconnect()
{
    std::shared_ptr<State> state;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        state = std::move(m_state);
    }
    if (state)
        state->stop();
}

inline bool BeastWebSocketEventTransport::running() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_state && m_state->running();
}

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceWebSocketTransport_ipp_
