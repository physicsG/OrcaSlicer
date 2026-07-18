#include <catch2/catch.hpp>

#include "libslic3r/MoonrakerFilamentSourceProvider.hpp"

#include "nlohmann/json.hpp"

#include <condition_variable>
#include <deque>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

struct RecordedRequest
{
    std::string method;
    std::string path;
    std::string body;
};

class FakeRestTransport final : public RestTransport
{
public:
    void queue_get(const std::string& path, TransportResponse response)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_get_responses[path].emplace_back(std::move(response));
    }

    void queue_post(const std::string& path, TransportResponse response)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_post_responses[path].emplace_back(std::move(response));
    }

    TransportResponse get(const std::string& path) override
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        requests.push_back({"GET", path, {}});
        if ((path == "/api/v1/inventory" || path == "/api/state") && m_block_next_inventory) {
            m_inventory_blocked = true;
            m_block_condition.notify_all();
            m_block_condition.wait(lock, [this] { return m_release_inventory; });
            m_block_next_inventory = false;
            m_inventory_blocked    = false;
            m_release_inventory    = false;
        }
        return pop_response(m_get_responses, path);
    }

    TransportResponse post(const std::string& path, const std::string& body) override
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        requests.push_back({"POST", path, body});
        return pop_response(m_post_responses, path);
    }

    void block_next_inventory_request()
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_block_next_inventory = true;
    }

    void wait_until_inventory_blocked()
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        m_block_condition.wait(lock, [this] { return m_inventory_blocked; });
    }

    void release_inventory_request()
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_release_inventory = true;
        m_block_condition.notify_all();
    }

    std::vector<RecordedRequest> requests;

private:
    static TransportResponse pop_response(std::map<std::string, std::deque<TransportResponse>>& responses, const std::string& path)
    {
        auto found = responses.find(path);
        if (found == responses.end() || found->second.empty())
            return {500, {}, "no fake response queued for " + path};
        TransportResponse response = std::move(found->second.front());
        found->second.pop_front();
        return response;
    }

    std::mutex                                           m_mutex;
    std::condition_variable                              m_block_condition;
    std::map<std::string, std::deque<TransportResponse>> m_get_responses;
    std::map<std::string, std::deque<TransportResponse>> m_post_responses;
    bool                                                 m_block_next_inventory = false;
    bool                                                 m_inventory_blocked    = false;
    bool                                                 m_release_inventory    = false;
};

class FakeEventTransport final : public EventTransport
{
public:
    void connect(const std::string& path, EventCallback event_callback, ConnectionCallback connection_callback) override
    {
        ++connect_count;
        connected_path        = path;
        m_event_callback      = std::move(event_callback);
        m_connection_callback = std::move(connection_callback);
    }

    void disconnect() override
    {
        ++disconnect_count;
        m_event_callback      = {};
        m_connection_callback = {};
    }

    void emit(const std::string& payload)
    {
        if (m_event_callback)
            m_event_callback(payload);
    }

    void set_connected(bool connected, const std::string& error = {})
    {
        if (m_connection_callback)
            m_connection_callback(connected, error);
    }

    int         connect_count    = 0;
    int         disconnect_count = 0;
    std::string connected_path;

private:
    EventCallback      m_event_callback;
    ConnectionCallback m_connection_callback;
};

TransportResponse json_response(const nlohmann::json& body, unsigned status_code = 200) { return {status_code, body.dump(), {}}; }

nlohmann::json web_fixture(const std::string& name)
{
    std::ifstream input(std::string(TEST_DATA_DIR) + "/multiace/" + name);
    if (!input)
        throw std::runtime_error("failed to open multiACE fixture: " + name);
    return nlohmann::json::parse(input);
}

nlohmann::json capabilities_payload(bool live_events = true, bool rfid_refresh = true, bool inventory = true)
{
    return {
        {"schema_version", 1},
        {"capabilities",
         {
             {"inventory", inventory},
             {"live_events", live_events},
             {"rfid_refresh", rfid_refresh},
             {"remaining_percent", true},
             {"dryer_state", true},
             {"per_source_routing", true},
             {"measured_change_timing", false},
         }},
    };
}

nlohmann::json inventory_payload(const std::string& revision,
                                 const std::string& state             = "ready",
                                 const std::string& material          = "PLA",
                                 int                remaining_percent = 75)
{
    return {
        {"schema_version", 1},
        {"revision", revision},
        {"sources", nlohmann::json::array({
                        {
                            {"source_id", "multiace:1:2"},
                            {"unit_id", 1},
                            {"slot_id", 2},
                            {"rfid_uid", "rfid-12"},
                            {"material", material},
                            {"subtype", material + " Basic"},
                            {"brand", "Snapmaker"},
                            {"color", "#D52332"},
                            {"remaining_percent", remaining_percent},
                            {"metadata_origin", "rfid"},
                            {"state", state},
                            {"reachable_toolheads", {0, 2}},
                            {"loaded_toolhead", 2},
                        },
                    })},
    };
}

std::shared_ptr<FakeRestTransport> configured_rest(const nlohmann::json& inventory    = inventory_payload("r1"),
                                                   const nlohmann::json& capabilities = capabilities_payload())
{
    auto rest = std::make_shared<FakeRestTransport>();
    rest->queue_get("/api/v1/capabilities", json_response(capabilities));
    rest->queue_get("/api/v1/inventory", json_response(inventory));
    return rest;
}

std::shared_ptr<FakeRestTransport> configured_web_rest(const nlohmann::json& inventory)
{
    auto rest = std::make_shared<FakeRestTransport>();
    rest->queue_get("/api/version", json_response({{"web", "0.99.5b"}}));
    rest->queue_get("/api/state", json_response(inventory));
    return rest;
}

} // namespace

TEST_CASE("Moonraker multiACE provider loads capabilities and inventory", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    std::vector<std::string>        revisions;
    MoonrakerFilamentSourceProvider provider(rest, events);
    const auto                      subscription = provider.subscribe(
        [&revisions](const InventorySnapshot& inventory) { revisions.emplace_back(inventory.revision); });

    REQUIRE(provider.start());
    CHECK(provider.is_started());
    CHECK(provider.capabilities().inventory);
    CHECK(provider.capabilities().live_events);
    CHECK(provider.inventory().revision == "r1");
    REQUIRE(provider.inventory().sources.size() == 1);
    CHECK(provider.inventory().sources[0].id.str() == "multiace:1:2");
    CHECK(revisions == std::vector<std::string>{"r1"});
    CHECK(events->connect_count == 1);
    CHECK(events->connected_path == "/api/v1/events");
    CHECK(provider.last_error().empty());
    CHECK(provider.unsubscribe(subscription));
}

TEST_CASE("Moonraker multiACE provider consumes the deployed multiACE Web profile", "[multiace][moonraker][web-contract]")
{
    const nlohmann::json            state  = web_fixture("multiace_web_state_v0.99.5b.json");
    const auto                      rest   = configured_web_rest(state);
    const auto                      events = std::make_shared<FakeEventTransport>();
    std::vector<InventorySnapshot>  received;
    MoonrakerFilamentSourceProvider provider(rest, events, MoonrakerEndpoints::multiace_web());
    const auto subscription = provider.subscribe([&received](const InventorySnapshot& inventory) { received.emplace_back(inventory); });

    REQUIRE(provider.start());
    CHECK(provider.capabilities().inventory);
    CHECK(provider.capabilities().live_events);
    CHECK(provider.capabilities().dryer_state);
    CHECK(provider.capabilities().per_source_routing);
    CHECK_FALSE(provider.capabilities().rfid_refresh);
    CHECK(provider.inventory().sources.size() == 8);
    CHECK(provider.inventory().revision.rfind("multiace-web:", 0) == 0);
    REQUIRE(rest->requests.size() == 2);
    CHECK(rest->requests[0].path == "/api/version");
    CHECK(rest->requests[1].path == "/api/state");
    CHECK(events->connected_path == "/ws");
    CHECK(received.size() == 1);
    CHECK(provider.unsubscribe(subscription));
}

TEST_CASE("Moonraker multiACE Web provider coalesces periodic state and recovers from Klippy disconnect",
          "[multiace][moonraker][web-contract]")
{
    nlohmann::json                  state  = web_fixture("multiace_web_state_v0.99.5b.json");
    const auto                      rest   = configured_web_rest(state);
    const auto                      events = std::make_shared<FakeEventTransport>();
    std::vector<InventorySnapshot>  received;
    MoonrakerFilamentSourceProvider provider(rest, events, MoonrakerEndpoints::multiace_web());
    const auto subscription = provider.subscribe([&received](const InventorySnapshot& inventory) { received.emplace_back(inventory); });
    REQUIRE(provider.start());
    REQUIRE(received.size() == 1);

    state["type"] = "state";
    state["ts"]   = state.at("ts").get<double>() + 1.0;
    events->emit(state.dump());
    CHECK(received.size() == 1);

    events->emit(R"json({"type":"gcode_error","msg":"printer-side load failed"})json");
    CHECK(received.size() == 1);
    CHECK(provider.last_error().empty());

    events->emit(R"json({"type":"state","klippy":"disconnected","ts":1784385602})json");
    REQUIRE(received.size() == 2);
    for (const FilamentSource& filament_source : provider.inventory().sources)
        CHECK(filament_source.state == SourceState::Offline);
    CHECK(provider.last_error().find("Klippy is disconnected") != std::string::npos);

    events->emit(state.dump());
    REQUIRE(received.size() == 3);
    CHECK(provider.inventory().sources.front().state != SourceState::Offline);
    CHECK(provider.last_error().empty());
    CHECK(provider.unsubscribe(subscription));
}

TEST_CASE("Moonraker multiACE Web REST disconnect retains metadata and marks inventory offline", "[multiace][moonraker][web-contract]")
{
    const auto                      rest = configured_web_rest(web_fixture("multiace_web_state_v0.99.5b.json"));
    MoonrakerFilamentSourceProvider provider(rest, {}, MoonrakerEndpoints::multiace_web());
    REQUIRE(provider.start());

    rest->queue_get("/api/state", json_response({{"klippy", "disconnected"}}));
    CHECK_FALSE(provider.refresh_inventory());

    REQUIRE(provider.inventory().sources.size() == 8);
    for (const FilamentSource& filament_source : provider.inventory().sources)
        CHECK(filament_source.state == SourceState::Offline);
    CHECK(provider.inventory().sources.front().material == "PLA");
    CHECK(provider.last_error().find("Klippy is disconnected") != std::string::npos);
}

TEST_CASE("Moonraker multiACE Web ignores a stale REST disconnect after a newer state event", "[multiace][moonraker][web-contract]")
{
    nlohmann::json                  state  = web_fixture("multiace_web_state_v0.99.5b.json");
    const auto                      rest   = configured_web_rest(state);
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events, MoonrakerEndpoints::multiace_web());
    REQUIRE(provider.start());

    rest->queue_get("/api/state", json_response({{"klippy", "disconnected"}}));
    rest->block_next_inventory_request();
    bool        refresh_succeeded = true;
    std::thread stale_refresh([&] { refresh_succeeded = provider.refresh_inventory(); });
    rest->wait_until_inventory_blocked();

    state["type"] = "state";
    events->emit(state.dump());
    rest->release_inventory_request();
    stale_refresh.join();

    CHECK_FALSE(refresh_succeeded);
    CHECK(provider.inventory().sources.front().state != SourceState::Offline);
    CHECK(provider.last_error().empty());
}

TEST_CASE("Moonraker multiACE provider applies full inventory events", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    nlohmann::json event_inventory = inventory_payload("r2", "loading", "PETG", 61);
    event_inventory.erase("schema_version");
    events->emit(nlohmann::json({{"schema_version", 1}, {"event", "inventory"}, {"inventory", event_inventory}}).dump());

    const InventorySnapshot inventory = provider.inventory();
    REQUIRE(inventory.revision == "r2");
    REQUIRE(inventory.sources.size() == 1);
    CHECK(inventory.sources[0].state == SourceState::Loading);
    CHECK(inventory.sources[0].material == "PETG");
    REQUIRE(inventory.sources[0].remaining_percent.has_value());
    CHECK(*inventory.sources[0].remaining_percent == 61);
}

TEST_CASE("Moonraker multiACE provider refreshes inventory for change notifications", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    rest->queue_get("/api/v1/inventory", json_response(inventory_payload("r2", "unloading")));
    events->emit(R"json({"schema_version":1,"event":"inventory_changed"})json");

    CHECK(provider.inventory().revision == "r2");
    CHECK(provider.inventory().sources[0].state == SourceState::Unloading);
    REQUIRE(rest->requests.size() == 3);
    CHECK(rest->requests.back().method == "GET");
    CHECK(rest->requests.back().path == "/api/v1/inventory");
}

TEST_CASE("Moonraker multiACE provider rejects unversioned trigger events", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    events->emit(R"json({"event":"inventory_changed"})json");

    CHECK(provider.inventory().revision == "r1");
    CHECK(rest->requests.size() == 2);
    CHECK(provider.last_error().find("schema_version") != std::string::npos);
}

TEST_CASE("Moonraker multiACE provider preserves newer events over stale REST refreshes", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    rest->queue_get("/api/v1/inventory", json_response(inventory_payload("r2", "loading")));
    rest->block_next_inventory_request();
    std::thread stale_refresh([&events] { events->emit(R"json({"schema_version":1,"event":"inventory_changed"})json"); });
    rest->wait_until_inventory_blocked();

    events->emit(inventory_payload("r3", "ready", "PETG", 44).dump());
    rest->release_inventory_request();
    stale_refresh.join();

    const InventorySnapshot inventory = provider.inventory();
    CHECK(inventory.revision == "r3");
    CHECK(inventory.sources[0].material == "PETG");
    REQUIRE(inventory.sources[0].remaining_percent.has_value());
    CHECK(*inventory.sources[0].remaining_percent == 44);
}

TEST_CASE("Moonraker multiACE provider lets repeated disconnects supersede stale REST refreshes", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    events->set_connected(false, "socket closed");
    REQUIRE(provider.inventory().sources.front().state == SourceState::Offline);

    rest->queue_get("/api/v1/inventory", json_response(inventory_payload("stale", "ready")));
    rest->block_next_inventory_request();
    bool        refresh_succeeded = false;
    std::thread stale_refresh([&] { refresh_succeeded = provider.refresh_inventory(); });
    rest->wait_until_inventory_blocked();

    events->set_connected(false, "still disconnected");
    rest->release_inventory_request();
    stale_refresh.join();

    CHECK(refresh_succeeded);
    CHECK(provider.inventory().revision == "r1");
    CHECK(provider.inventory().sources.front().state == SourceState::Offline);
    CHECK(provider.last_error().find("still disconnected") != std::string::npos);
}

TEST_CASE("Moonraker multiACE provider preserves metadata across disconnect and reconnect", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    events->set_connected(false, "socket closed");
    InventorySnapshot offline = provider.inventory();
    REQUIRE(offline.sources.size() == 1);
    CHECK(offline.sources[0].state == SourceState::Offline);
    CHECK(offline.sources[0].material == "PLA");
    CHECK(offline.sources[0].rfid_uid == "rfid-12");
    CHECK(provider.last_error().find("socket closed") != std::string::npos);

    rest->queue_get("/api/v1/inventory", json_response(inventory_payload("r2", "ready", "PETG", 52)));
    events->set_connected(true);

    const InventorySnapshot reconnected = provider.inventory();
    CHECK(provider.events_connected());
    CHECK(reconnected.revision == "r2");
    CHECK(reconnected.sources[0].state == SourceState::Ready);
    CHECK(reconnected.sources[0].material == "PETG");
    CHECK(provider.last_error().empty());
}

TEST_CASE("Moonraker multiACE provider ignores malformed events without corrupting inventory", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    events->emit("{broken-json");
    CHECK(provider.inventory().revision == "r1");
    CHECK_FALSE(provider.last_error().empty());

    events->emit(inventory_payload("r2").dump());
    CHECK(provider.inventory().revision == "r2");
    CHECK(provider.last_error().empty());
}

TEST_CASE("Moonraker multiACE provider contains inventory subscriber failures", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    const auto subscription = provider.subscribe([](const InventorySnapshot& inventory) {
        if (inventory.revision == "r2")
            throw std::runtime_error("subscriber failed");
    });

    CHECK_NOTHROW(events->emit(inventory_payload("r2").dump()));
    CHECK(provider.inventory().revision == "r2");
    CHECK(provider.last_error().find("subscriber failed") != std::string::npos);
    CHECK(provider.unsubscribe(subscription));
}

TEST_CASE("Moonraker multiACE provider posts RFID refresh and reloads inventory", "[multiace][moonraker]")
{
    const auto                      rest = configured_rest();
    MoonrakerFilamentSourceProvider provider(rest);
    REQUIRE(provider.start());

    const std::string refresh_path = "/api/v1/sources/multiace%3A1%3A2/refresh";
    rest->queue_post(refresh_path, {204, {}, {}});
    rest->queue_get("/api/v1/inventory", json_response(inventory_payload("r2", "ready", "ABS", 91)));

    provider.request_metadata_refresh(SourceId{"multiace", "1", "2"});

    REQUIRE(rest->requests.size() == 4);
    CHECK(rest->requests[2].method == "POST");
    CHECK(rest->requests[2].path == refresh_path);
    CHECK(rest->requests[2].body == "{}");
    CHECK(rest->requests[3].path == "/api/v1/inventory");
    CHECK(provider.inventory().revision == "r2");
    CHECK(provider.inventory().sources[0].material == "ABS");
}

TEST_CASE("Moonraker multiACE provider keeps the last valid snapshot after HTTP failures", "[multiace][moonraker]")
{
    const auto                      rest = configured_rest();
    MoonrakerFilamentSourceProvider provider(rest);
    REQUIRE(provider.start());

    rest->queue_get("/api/v1/inventory", {503, R"json({"error":"offline"})json", {}});
    CHECK_FALSE(provider.refresh_inventory());
    CHECK(provider.inventory().revision == "r1");
    CHECK(provider.last_error().find("HTTP 503") != std::string::npos);
}

TEST_CASE("Moonraker multiACE provider requires advertised inventory support", "[multiace][moonraker]")
{
    const auto                      rest = configured_rest(inventory_payload("unused"), capabilities_payload(false, false, false));
    MoonrakerFilamentSourceProvider provider(rest);

    CHECK_FALSE(provider.start());
    CHECK_FALSE(provider.is_started());
    CHECK(provider.inventory().sources.empty());
    CHECK(provider.last_error().find("does not advertise inventory") != std::string::npos);
}

TEST_CASE("Moonraker multiACE provider validates refresh source providers", "[multiace][moonraker]")
{
    const auto                      rest = configured_rest();
    MoonrakerFilamentSourceProvider provider(rest);
    REQUIRE(provider.start());

    CHECK_THROWS_WITH((provider.request_metadata_refresh(SourceId{"other", "1", "2"})), "metadata refresh requires a multiace source ID");
}

TEST_CASE("Moonraker multiACE provider marks inventory offline when stopped", "[multiace][moonraker]")
{
    const auto                      rest   = configured_rest();
    const auto                      events = std::make_shared<FakeEventTransport>();
    MoonrakerFilamentSourceProvider provider(rest, events);
    REQUIRE(provider.start());

    provider.stop();
    provider.stop();

    CHECK_FALSE(provider.is_started());
    CHECK_FALSE(provider.events_connected());
    CHECK(provider.inventory().sources[0].state == SourceState::Offline);
    CHECK(events->disconnect_count == 1);
}
