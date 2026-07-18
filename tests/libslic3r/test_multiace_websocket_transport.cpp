#include <catch2/catch.hpp>

#include "libslic3r/MultiAceWebSocketTransport.hpp"

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/websocket.hpp>

#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace Slic3r::MultiAce;
using namespace std::chrono_literals;

namespace {

namespace asio      = boost::asio;
namespace beast     = boost::beast;
namespace http      = beast::http;
namespace websocket = beast::websocket;
using tcp           = asio::ip::tcp;

struct ServerSession
{
    std::string message;
    bool        close_after_write = false;
};

struct RecordedHandshake
{
    std::string target;
    std::string authorization;
    std::string test_header;
};

class LoopbackWebSocketServer
{
public:
    explicit LoopbackWebSocketServer(std::vector<ServerSession> sessions)
        : m_acceptor(m_io, tcp::endpoint(asio::ip::make_address("127.0.0.1"), 0)), m_sessions(std::move(sessions))
    {
        m_port   = m_acceptor.local_endpoint().port();
        m_worker = std::thread([this] { run(); });
    }

    ~LoopbackWebSocketServer()
    {
        boost::system::error_code ignored;
        m_acceptor.cancel(ignored);
        m_acceptor.close(ignored);
        if (m_worker.joinable())
            m_worker.join();
    }

    unsigned short port() const { return m_port; }

    bool wait_for_handshakes(std::size_t count, std::chrono::milliseconds timeout = 5s)
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        return m_condition.wait_for(lock, timeout, [this, count] { return m_handshakes.size() >= count; });
    }

    std::vector<RecordedHandshake> handshakes() const
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_handshakes;
    }

private:
    void run()
    {
        for (const ServerSession& session : m_sessions) {
            boost::system::error_code error;
            tcp::socket               socket(m_io);
            m_acceptor.accept(socket, error);
            if (error)
                return;

            websocket::stream<tcp::socket> web_socket(std::move(socket));
            beast::flat_buffer             request_buffer;
            http::request<http::string_body> request;
            http::read(web_socket.next_layer(), request_buffer, request, error);
            if (error)
                return;

            RecordedHandshake handshake;
            handshake.target = std::string(request.target());
            if (request.find(http::field::authorization) != request.end())
                handshake.authorization = request.at(http::field::authorization).to_string();
            if (request.find("X-MultiAce-Test") != request.end())
                handshake.test_header = request.at("X-MultiAce-Test").to_string();
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                m_handshakes.emplace_back(std::move(handshake));
            }
            m_condition.notify_all();

            web_socket.accept(request, error);
            if (error)
                return;
            web_socket.text(true);
            web_socket.write(asio::buffer(session.message), error);
            if (error)
                return;

            if (session.close_after_write) {
                web_socket.close(websocket::close_code::normal, error);
                continue;
            }

            beast::flat_buffer read_buffer;
            web_socket.read(read_buffer, error);
            return;
        }
    }

    asio::io_context              m_io;
    tcp::acceptor                  m_acceptor;
    std::vector<ServerSession>     m_sessions;
    unsigned short                 m_port = 0;
    std::thread                    m_worker;
    mutable std::mutex             m_mutex;
    std::condition_variable        m_condition;
    std::vector<RecordedHandshake> m_handshakes;
};

class CallbackLog
{
public:
    void event(const std::string& message)
    {
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_events.emplace_back(message);
        }
        m_condition.notify_all();
    }

    void connection(bool connected, const std::string& error)
    {
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_connections.emplace_back(connected);
            m_errors.emplace_back(error);
        }
        m_condition.notify_all();
    }

    bool wait_for_events(std::size_t count, std::chrono::milliseconds timeout = 5s)
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        return m_condition.wait_for(lock, timeout, [this, count] { return m_events.size() >= count; });
    }

    std::vector<std::string> events() const
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_events;
    }

    std::vector<bool> connections() const
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_connections;
    }

private:
    mutable std::mutex       m_mutex;
    std::condition_variable  m_condition;
    std::vector<std::string> m_events;
    std::vector<bool>        m_connections;
    std::vector<std::string> m_errors;
};

WebSocketEventTransportConfig config_for(const LoopbackWebSocketServer& server)
{
    WebSocketEventTransportConfig config;
    config.base_url                = "ws://127.0.0.1:" + std::to_string(server.port());
    config.handshake_timeout       = 2s;
    config.reconnect_initial_delay = 20ms;
    config.reconnect_max_delay     = 80ms;
    return config;
}

} // namespace

TEST_CASE("multiACE WebSocket endpoint parsing normalizes origins and paths", "[multiace][websocket]")
{
    SECTION("host and base path")
    {
        const WebSocketEndpoint endpoint = parse_websocket_endpoint("ws://printer.local:7125/multiace", "/api/v1/events?all=1");
        CHECK(endpoint.host == "printer.local");
        CHECK(endpoint.port == "7125");
        CHECK(endpoint.target == "/multiace/api/v1/events?all=1");
        CHECK(endpoint.host_header == "printer.local:7125");
    }

    SECTION("default port")
    {
        const WebSocketEndpoint endpoint = parse_websocket_endpoint("ws://printer.local", "events");
        CHECK(endpoint.port == "80");
        CHECK(endpoint.target == "/events");
        CHECK(endpoint.host_header == "printer.local");
    }

    SECTION("IPv6")
    {
        const WebSocketEndpoint endpoint = parse_websocket_endpoint("ws://[::1]:7125", "/events");
        CHECK(endpoint.host == "::1");
        CHECK(endpoint.host_header == "[::1]:7125");
    }

    CHECK_THROWS_WITH(parse_websocket_endpoint("wss://printer.local", "/events"),
                      "multiACE WebSocket TLS (wss://) is not supported yet");
    CHECK_THROWS_WITH(parse_websocket_endpoint("http://printer.local", "/events"),
                      "multiACE WebSocket base URL must start with ws://");
    CHECK_THROWS_WITH(parse_websocket_endpoint("ws://user@printer.local", "/events"),
                      "multiACE WebSocket credentials must be configured separately from the URL");
    CHECK_THROWS_WITH(parse_websocket_endpoint("ws://printer.local:70000", "/events"),
                      "multiACE WebSocket port is outside the supported range");
}

TEST_CASE("multiACE WebSocket reconnect backoff is bounded", "[multiace][websocket]")
{
    CHECK(websocket_reconnect_delay(100ms, 1000ms, 0) == 100ms);
    CHECK(websocket_reconnect_delay(100ms, 1000ms, 1) == 200ms);
    CHECK(websocket_reconnect_delay(100ms, 1000ms, 3) == 800ms);
    CHECK(websocket_reconnect_delay(100ms, 1000ms, 4) == 1000ms);
    CHECK(websocket_reconnect_delay(100ms, 1000ms, 50) == 1000ms);
    CHECK_THROWS_AS(websocket_reconnect_delay(0ms, 1000ms, 0), std::invalid_argument);
}

TEST_CASE("multiACE Beast WebSocket transport receives text events and sends configured headers", "[multiace][websocket]")
{
    LoopbackWebSocketServer server({{"hello", false}});
    WebSocketEventTransportConfig config = config_for(server);
    config.bearer_token                   = "token-123";
    config.headers.emplace("X-MultiAce-Test", "header-value");

    CallbackLog                   log;
    BeastWebSocketEventTransport transport(config);
    transport.connect("/events",
                      [&log](const std::string& message) { log.event(message); },
                      [&log](bool connected, const std::string& error) { log.connection(connected, error); });

    REQUIRE(log.wait_for_events(1));
    REQUIRE(server.wait_for_handshakes(1));
    CHECK(log.events() == std::vector<std::string>{"hello"});

    const std::vector<RecordedHandshake> handshakes = server.handshakes();
    REQUIRE(handshakes.size() == 1);
    CHECK(handshakes[0].target == "/events");
    CHECK(handshakes[0].authorization == "Bearer token-123");
    CHECK(handshakes[0].test_header == "header-value");

    transport.disconnect();
    CHECK_FALSE(transport.running());
    CHECK(log.connections() == std::vector<bool>{true, false});
}

TEST_CASE("multiACE Beast WebSocket transport reconnects after a dropped session", "[multiace][websocket]")
{
    LoopbackWebSocketServer server({{"first", true}, {"second", false}});
    CallbackLog             log;
    BeastWebSocketEventTransport transport(config_for(server));

    transport.connect("/events",
                      [&log](const std::string& message) { log.event(message); },
                      [&log](bool connected, const std::string& error) { log.connection(connected, error); });

    REQUIRE(log.wait_for_events(2));
    REQUIRE(server.wait_for_handshakes(2));
    CHECK((log.events() == std::vector<std::string>{"first", "second"}));

    transport.disconnect();
    const std::vector<bool> connections = log.connections();
    REQUIRE(connections.size() == 4);
    CHECK(connections[0]);
    CHECK_FALSE(connections[1]);
    CHECK(connections[2]);
    CHECK_FALSE(connections[3]);
}

TEST_CASE("multiACE Beast WebSocket transport validates configuration", "[multiace][websocket]")
{
    WebSocketEventTransportConfig config;
    config.base_url = "ws://localhost";

    SECTION("conflicting authentication")
    {
        config.username     = "user";
        config.password     = "password";
        config.bearer_token = "token";
        CHECK_THROWS_WITH(BeastWebSocketEventTransport(config),
                          "multiACE WebSocket basic and bearer authentication are mutually exclusive");
    }

    SECTION("authorization header collision")
    {
        config.bearer_token = "token";
        config.headers.emplace("authorization", "other");
        CHECK_THROWS_WITH(BeastWebSocketEventTransport(config),
                          "multiACE WebSocket Authorization header conflicts with configured authentication");
    }

    SECTION("invalid reconnect bounds")
    {
        config.reconnect_initial_delay = 2s;
        config.reconnect_max_delay     = 1s;
        CHECK_THROWS_WITH(BeastWebSocketEventTransport(config),
                          "multiACE WebSocket initial reconnect delay must not exceed the maximum");
    }
}
