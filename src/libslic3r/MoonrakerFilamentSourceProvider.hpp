#ifndef slic3r_MoonrakerFilamentSourceProvider_hpp_
#define slic3r_MoonrakerFilamentSourceProvider_hpp_

#include "FilamentSourceProvider.hpp"
#include "MultiAceTransport.hpp"
#include "MultiAceWebPayload.hpp"

#include "nlohmann/json.hpp"

#include <atomic>
#include <cctype>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

enum class MoonrakerApiProfile {
    VersionedInventoryV1,
    MultiAceWeb,
};

struct MoonrakerEndpoints
{
    std::string         capabilities = "/api/v1/capabilities";
    std::string         inventory    = "/api/v1/inventory";
    std::string         events       = "/api/v1/events";
    std::string         sources      = "/api/v1/sources";
    MoonrakerApiProfile profile      = MoonrakerApiProfile::VersionedInventoryV1;

    static MoonrakerEndpoints multiace_web()
    {
        MoonrakerEndpoints endpoints;
        endpoints.capabilities = "/api/version";
        endpoints.inventory    = "/api/state";
        endpoints.events       = "/ws";
        endpoints.sources.clear();
        endpoints.profile = MoonrakerApiProfile::MultiAceWeb;
        return endpoints;
    }
};

class MoonrakerFilamentSourceProvider final : public FilamentSourceProvider
{
public:
    MoonrakerFilamentSourceProvider(std::shared_ptr<RestTransport>  rest_transport,
                                    std::shared_ptr<EventTransport> event_transport = {},
                                    MoonrakerEndpoints              endpoints       = {})
        : m_rest_transport(std::move(rest_transport)), m_event_transport(std::move(event_transport)), m_endpoints(std::move(endpoints))
    {
        if (!m_rest_transport)
            throw std::invalid_argument("multiACE REST transport is required");
        m_callback_state->owner = this;
    }

    ~MoonrakerFilamentSourceProvider() override
    {
        stop();
        std::unique_lock<std::mutex> lock(m_callback_state->mutex);
        m_callback_state->owner = nullptr;
        m_callback_state->callbacks_drained.wait(lock, [this] { return m_callback_state->active_callbacks == 0; });
    }

    ProviderCapabilities capabilities() const override { return m_state.capabilities(); }
    InventorySnapshot    inventory() const override { return m_state.inventory(); }
    SubscriptionId       subscribe(InventoryCallback callback) override { return m_state.subscribe(std::move(callback)); }
    bool                 unsubscribe(SubscriptionId subscription_id) override { return m_state.unsubscribe(subscription_id); }

    void request_metadata_refresh(const SourceId& source) override
    {
        if (source.provider != "multiace")
            throw std::invalid_argument("metadata refresh requires a multiace source ID");

        if (!capabilities().rfid_refresh) {
            set_last_error("multiACE metadata refresh is not supported by this provider");
            return;
        }

        const std::string path = m_endpoints.sources + '/' + percent_encode_path_segment(source.str()) + "/refresh";
        try {
            const TransportResponse response = m_rest_transport->post(path, "{}");
            require_success(response, "multiACE metadata refresh");
        } catch (const std::exception& error) {
            set_last_error(error.what());
            return;
        } catch (...) {
            set_last_error("multiACE metadata refresh failed with an unknown error");
            return;
        }

        refresh_inventory(next_update_sequence());
    }

    bool start()
    {
        {
            std::lock_guard<std::mutex> lock(m_status_mutex);
            if (m_started)
                return true;
        }

        clear_last_error();
        if (!refresh_capabilities())
            return false;
        if (!capabilities().inventory) {
            set_last_error("multiACE provider does not advertise inventory support");
            return false;
        }
        if (!refresh_inventory(next_update_sequence()))
            return false;

        {
            std::lock_guard<std::mutex> lock(m_status_mutex);
            m_started = true;
        }

        if (capabilities().live_events && m_event_transport) {
            try {
                const std::weak_ptr<CallbackState> callback_state = m_callback_state;
                m_event_transport->connect(
                    m_endpoints.events,
                    [callback_state](const std::string& payload) {
                        invoke_owner(callback_state, [payload](MoonrakerFilamentSourceProvider& owner) { owner.handle_event(payload); });
                    },
                    [callback_state](bool connected, const std::string& error) {
                        invoke_owner(callback_state, [connected, error](MoonrakerFilamentSourceProvider& owner) {
                            owner.handle_event_connection(connected, error);
                        });
                    });
            } catch (const std::exception& error) {
                set_last_error(std::string("multiACE event connection failed: ") + error.what());
            } catch (...) {
                set_last_error("multiACE event connection failed with an unknown error");
            }
        }

        return true;
    }

    void stop()
    {
        bool was_active = false;
        {
            std::lock_guard<std::mutex> lock(m_status_mutex);
            was_active = m_started || m_events_connected;
        }
        if (!was_active)
            return;

        if (m_event_transport) {
            try {
                m_event_transport->disconnect();
            } catch (...) {}
        }

        {
            std::lock_guard<std::mutex> lock(m_status_mutex);
            m_started          = false;
            m_events_connected = false;
        }

        try {
            mark_inventory_offline(next_update_sequence());
        } catch (const std::exception& error) {
            set_last_error(error.what());
        } catch (...) {
            set_last_error("multiACE inventory subscriber failed during shutdown");
        }
    }

    bool refresh_capabilities()
    {
        try {
            const TransportResponse response = m_rest_transport->get(m_endpoints.capabilities);
            require_success(response, "multiACE capabilities request");
            const nlohmann::json       response_json = parse_json(response.body, "multiACE capabilities response");
            const ProviderCapabilities parsed        = m_endpoints.profile == MoonrakerApiProfile::MultiAceWeb ?
                                                           parse_multiace_web_capabilities(response_json) :
                                                           parse_capabilities(response_json);
            m_state.set_capabilities(parsed);
            clear_last_error();
            return true;
        } catch (const std::exception& error) {
            set_last_error(error.what());
            return false;
        } catch (...) {
            set_last_error("multiACE capabilities request failed with an unknown error");
            return false;
        }
    }

    bool refresh_inventory() { return refresh_inventory(next_update_sequence()); }

    void handle_event(const std::string& payload)
    {
        const std::uint64_t sequence = next_update_sequence();
        try {
            const nlohmann::json event = parse_json(payload, "multiACE event");
            if (!event.is_object())
                throw std::invalid_argument("multiACE event must be a JSON object");

            if (m_endpoints.profile == MoonrakerApiProfile::MultiAceWeb) {
                handle_multiace_web_event(event, sequence);
                return;
            }

            const nlohmann::json* inventory_payload = find_inventory_payload(event);
            if (inventory_payload != nullptr) {
                nlohmann::json normalized = *inventory_payload;
                if (!normalized.contains("schema_version") && event.contains("schema_version"))
                    normalized["schema_version"] = event.at("schema_version");
                if (publish_inventory(parse_inventory(normalized), sequence))
                    clear_last_error();
                return;
            }

            detail::parse_schema_version(event);
            const std::string event_type = read_event_type(event);
            if (event_type == "inventory_changed" || event_type == "source_changed" || event_type == "rfid_updated" ||
                event_type == "refresh") {
                refresh_inventory(sequence);
            }
        } catch (const std::exception& error) {
            set_last_error(error.what());
        } catch (...) {
            set_last_error("multiACE event handling failed with an unknown error");
        }
    }

    bool is_started() const
    {
        std::lock_guard<std::mutex> lock(m_status_mutex);
        return m_started;
    }

    bool events_connected() const
    {
        std::lock_guard<std::mutex> lock(m_status_mutex);
        return m_events_connected;
    }

    std::string last_error() const
    {
        std::lock_guard<std::mutex> lock(m_status_mutex);
        return m_last_error;
    }

private:
    struct CallbackState
    {
        std::mutex                       mutex;
        std::condition_variable          callbacks_drained;
        MoonrakerFilamentSourceProvider* owner            = nullptr;
        std::size_t                      active_callbacks = 0;
    };

    template<class Callback> static void invoke_owner(const std::weak_ptr<CallbackState>& weak_state, Callback&& callback)
    {
        const std::shared_ptr<CallbackState> state = weak_state.lock();
        if (!state)
            return;

        MoonrakerFilamentSourceProvider* owner = nullptr;
        {
            std::lock_guard<std::mutex> lock(state->mutex);
            if (state->owner == nullptr)
                return;
            owner = state->owner;
            ++state->active_callbacks;
        }

        try {
            callback(*owner);
        } catch (...) {
            release_callback(state);
            throw;
        }
        release_callback(state);
    }

    static void release_callback(const std::shared_ptr<CallbackState>& state)
    {
        std::lock_guard<std::mutex> lock(state->mutex);
        --state->active_callbacks;
        if (state->active_callbacks == 0)
            state->callbacks_drained.notify_all();
    }

    static nlohmann::json parse_json(const std::string& body, const std::string& description)
    {
        try {
            return nlohmann::json::parse(body);
        } catch (const nlohmann::json::exception& error) {
            throw std::invalid_argument(description + " is invalid JSON: " + error.what());
        }
    }

    static void require_success(const TransportResponse& response, const std::string& operation)
    {
        if (response.successful())
            return;

        std::string message = operation + " failed";
        if (response.status_code != 0)
            message += " with HTTP " + std::to_string(response.status_code);
        if (!response.error.empty())
            message += ": " + response.error;
        throw std::runtime_error(message);
    }

    static std::string read_event_type(const nlohmann::json& event)
    {
        const char* fields[] = {"event", "type"};
        for (const char* field : fields) {
            if (!event.contains(field) || event.at(field).is_null())
                continue;
            if (!event.at(field).is_string())
                throw std::invalid_argument(std::string("multiACE event ") + field + " must be a string");
            return event.at(field).get<std::string>();
        }
        return {};
    }

    static const nlohmann::json* find_inventory_payload(const nlohmann::json& event)
    {
        if (event.contains("sources") && event.contains("revision"))
            return &event;
        if (event.contains("inventory")) {
            if (!event.at("inventory").is_object())
                throw std::invalid_argument("multiACE event inventory must be a JSON object");
            return &event.at("inventory");
        }
        if (event.contains("data") && event.at("data").is_object() && event.at("data").contains("inventory")) {
            if (!event.at("data").at("inventory").is_object())
                throw std::invalid_argument("multiACE event data.inventory must be a JSON object");
            return &event.at("data").at("inventory");
        }
        return nullptr;
    }

    void handle_multiace_web_event(const nlohmann::json& event, std::uint64_t sequence)
    {
        const std::string event_type = read_event_type(event);
        if (event_type == "state") {
            if (multiace_web_reports_disconnected(event)) {
                if (mark_inventory_offline(sequence))
                    set_last_error("multiACE Web reports that Klippy is disconnected");
                return;
            }
            if (publish_inventory(parse_multiace_web_inventory(event), sequence))
                clear_last_error();
            return;
        }

        if (event_type == "error") {
            const std::string error = web_detail::optional_string(event, "error");
            set_last_error(error.empty() ? "multiACE Web reported an event error" : "multiACE Web event error: " + error);
        }
    }

    static std::string percent_encode_path_segment(const std::string& value)
    {
        static constexpr char HEX[] = "0123456789ABCDEF";
        std::string           encoded;
        encoded.reserve(value.size());
        for (const unsigned char character : value) {
            if (std::isalnum(character) || character == '-' || character == '_' || character == '.' || character == '~') {
                encoded.push_back(static_cast<char>(character));
            } else {
                encoded.push_back('%');
                encoded.push_back(HEX[(character >> 4) & 0x0F]);
                encoded.push_back(HEX[character & 0x0F]);
            }
        }
        return encoded;
    }

    void handle_event_connection(bool connected, const std::string& error)
    {
        const std::uint64_t sequence = next_update_sequence();
        try {
            {
                std::lock_guard<std::mutex> lock(m_status_mutex);
                m_events_connected = connected;
            }

            if (connected) {
                refresh_inventory(sequence);
            } else {
                if (mark_inventory_offline(sequence))
                    set_last_error(error.empty() ? "multiACE event connection lost" : "multiACE event connection lost: " + error);
            }
        } catch (const std::exception& callback_error) {
            set_last_error(callback_error.what());
        } catch (...) {
            set_last_error("multiACE connection callback failed with an unknown error");
        }
    }

    bool refresh_inventory(std::uint64_t sequence)
    {
        InventorySnapshot snapshot;
        bool              service_disconnected = false;
        try {
            std::lock_guard<std::mutex> lock(m_refresh_mutex);
            const TransportResponse     response = m_rest_transport->get(m_endpoints.inventory);
            require_success(response, "multiACE inventory request");
            const nlohmann::json response_json = parse_json(response.body, "multiACE inventory response");
            service_disconnected               = m_endpoints.profile == MoonrakerApiProfile::MultiAceWeb &&
                                   multiace_web_reports_disconnected(response_json);
            if (!service_disconnected) {
                snapshot = m_endpoints.profile == MoonrakerApiProfile::MultiAceWeb ? parse_multiace_web_inventory(response_json) :
                                                                                     parse_inventory(response_json);
            }
        } catch (const std::exception& error) {
            set_last_error(error.what());
            return false;
        } catch (...) {
            set_last_error("multiACE inventory request failed with an unknown error");
            return false;
        }

        if (service_disconnected) {
            try {
                if (mark_inventory_offline(sequence))
                    set_last_error("multiACE Web reports that Klippy is disconnected");
            } catch (const std::exception& error) {
                set_last_error(std::string("multiACE Web reports that Klippy is disconnected; inventory subscriber failed: ") +
                               error.what());
            } catch (...) {
                set_last_error("multiACE Web reports that Klippy is disconnected; inventory subscriber failed with an unknown error");
            }
            return false;
        }

        bool accepted = false;
        try {
            accepted = publish_inventory(std::move(snapshot), sequence);
        } catch (const std::exception& error) {
            set_last_error(error.what());
            return false;
        } catch (...) {
            set_last_error("multiACE inventory subscriber failed");
            return false;
        }

        if (accepted)
            clear_last_error();
        return true;
    }

    bool publish_inventory(InventorySnapshot snapshot, std::uint64_t sequence)
    {
        std::lock_guard<std::recursive_mutex> lock(m_publish_mutex);
        if (sequence <= m_last_published_sequence)
            return false;
        m_last_published_sequence = sequence;
        if (m_state.inventory() == snapshot)
            return true;
        m_state.set_inventory(std::move(snapshot));
        return true;
    }

    bool mark_inventory_offline(std::uint64_t sequence)
    {
        InventorySnapshot snapshot = inventory();
        for (FilamentSource& source : snapshot.sources) {
            if (source.state != SourceState::Offline)
                source.state = SourceState::Offline;
        }
        return publish_inventory(std::move(snapshot), sequence);
    }

    std::uint64_t next_update_sequence() { return m_next_update_sequence.fetch_add(1, std::memory_order_relaxed); }

    void set_last_error(std::string error)
    {
        std::lock_guard<std::mutex> lock(m_status_mutex);
        m_last_error = std::move(error);
    }

    void clear_last_error()
    {
        std::lock_guard<std::mutex> lock(m_status_mutex);
        m_last_error.clear();
    }

    ManualFilamentSourceProvider    m_state;
    std::shared_ptr<RestTransport>  m_rest_transport;
    std::shared_ptr<EventTransport> m_event_transport;
    MoonrakerEndpoints              m_endpoints;
    std::shared_ptr<CallbackState>  m_callback_state = std::make_shared<CallbackState>();
    mutable std::mutex              m_status_mutex;
    std::mutex                      m_refresh_mutex;
    std::recursive_mutex            m_publish_mutex;
    std::atomic<std::uint64_t>      m_next_update_sequence{1};
    std::uint64_t                   m_last_published_sequence = 0;
    bool                            m_started                 = false;
    bool                            m_events_connected        = false;
    std::string                     m_last_error;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MoonrakerFilamentSourceProvider_hpp_
