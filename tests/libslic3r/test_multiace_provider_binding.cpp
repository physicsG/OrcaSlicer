#include <catch2/catch.hpp>

#include "libslic3r/FilamentSourceBinding.hpp"

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

InventorySnapshot snapshot(std::string revision)
{
    InventorySnapshot result;
    result.schema_version = SUPPORTED_SCHEMA_VERSION;
    result.revision       = std::move(revision);
    return result;
}

class QueueDispatcher
{
public:
    void post(std::function<void()> callback)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_callbacks.emplace_back(std::move(callback));
    }

    std::size_t size() const
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_callbacks.size();
    }

    void run_all()
    {
        for (;;) {
            std::function<void()> callback;
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                if (m_callbacks.empty())
                    return;
                callback = std::move(m_callbacks.front());
                m_callbacks.pop_front();
            }
            callback();
        }
    }

private:
    mutable std::mutex                m_mutex;
    std::deque<std::function<void()>> m_callbacks;
};

class RetainedCallbackProvider final : public FilamentSourceProvider
{
public:
    explicit RetainedCallbackProvider(InventorySnapshot initial) : m_inventory(std::move(initial)) {}

    ProviderCapabilities capabilities() const override { return {}; }

    InventorySnapshot inventory() const override
    {
        InventoryCallback callback;
        InventorySnapshot result;
        InventorySnapshot event;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            callback = m_emit_during_inventory ? m_callback : InventoryCallback{};
            result   = m_inventory;
            event    = m_inventory_event;
        }
        if (callback)
            callback(event);
        return result;
    }

    SubscriptionId subscribe(InventoryCallback callback) override
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_callback       = std::move(callback);
        m_retained_stale = m_callback;
        return 1;
    }

    bool unsubscribe(SubscriptionId subscription_id) override
    {
        if (subscription_id != 1)
            return false;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_callback     = {};
            m_unsubscribed = true;
        }
        m_unsubscribe_condition.notify_all();
        return true;
    }

    void request_metadata_refresh(const SourceId&) override {}

    void configure_inventory_race(InventorySnapshot event_snapshot)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_emit_during_inventory = true;
        m_inventory_event       = std::move(event_snapshot);
    }

    void emit(InventorySnapshot inventory)
    {
        InventoryCallback callback;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_inventory = inventory;
            callback    = m_callback;
        }
        if (callback)
            callback(inventory);
    }

    void emit_retained_stale(InventorySnapshot inventory)
    {
        InventoryCallback callback;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            callback = m_retained_stale;
        }
        if (callback)
            callback(inventory);
    }

    void wait_until_unsubscribed()
    {
        std::unique_lock<std::mutex> lock(m_mutex);
        m_unsubscribe_condition.wait(lock, [this] { return m_unsubscribed; });
    }

private:
    mutable std::mutex      m_mutex;
    std::condition_variable m_unsubscribe_condition;
    InventorySnapshot       m_inventory;
    InventorySnapshot       m_inventory_event;
    InventoryCallback       m_callback;
    InventoryCallback       m_retained_stale;
    bool                    m_emit_during_inventory = false;
    bool                    m_unsubscribed          = false;
};

} // namespace

TEST_CASE("multiACE provider binding dispatches initial and live inventory on the owner dispatcher", "[multiace][binding]")
{
    auto provider   = std::make_shared<ManualFilamentSourceProvider>(ProviderCapabilities{}, snapshot("r1"));
    auto dispatcher = std::make_shared<QueueDispatcher>();

    std::vector<std::string> revisions;
    FilamentSourceBinding binding(provider,
                                  [dispatcher](std::function<void()> callback) { dispatcher->post(std::move(callback)); },
                                  [&revisions](const InventorySnapshot& inventory) { revisions.emplace_back(inventory.revision); });

    CHECK(revisions.empty());
    CHECK(dispatcher->size() == 1);
    dispatcher->run_all();
    CHECK(revisions == std::vector<std::string>{"r1"});

    provider->set_inventory(snapshot("r2"));
    provider->set_inventory(snapshot("r3"));
    CHECK(revisions == std::vector<std::string>{"r1"});
    CHECK(dispatcher->size() == 1);

    dispatcher->run_all();
    CHECK((revisions == std::vector<std::string>{"r1", "r2", "r3"}));
    CHECK(binding.last_error().empty());
}

TEST_CASE("multiACE provider binding marshals worker updates to the dispatcher thread", "[multiace][binding]")
{
    auto provider   = std::make_shared<ManualFilamentSourceProvider>(ProviderCapabilities{}, snapshot("r1"));
    auto dispatcher = std::make_shared<QueueDispatcher>();

    const std::thread::id        owner_thread = std::this_thread::get_id();
    std::vector<std::thread::id> apply_threads;
    FilamentSourceBinding binding(provider,
                                  [dispatcher](std::function<void()> callback) { dispatcher->post(std::move(callback)); },
                                  [&apply_threads](const InventorySnapshot&) { apply_threads.emplace_back(std::this_thread::get_id()); });
    dispatcher->run_all();

    std::thread worker([provider] { provider->set_inventory(snapshot("worker")); });
    worker.join();

    REQUIRE(apply_threads.size() == 1);
    dispatcher->run_all();
    REQUIRE(apply_threads.size() == 2);
    CHECK(apply_threads.back() == owner_thread);
}

TEST_CASE("multiACE provider binding prevents a stale initial read from overwriting a newer callback", "[multiace][binding]")
{
    auto provider   = std::make_shared<RetainedCallbackProvider>(snapshot("old"));
    auto dispatcher = std::make_shared<QueueDispatcher>();
    provider->configure_inventory_race(snapshot("new"));

    std::vector<std::string> revisions;
    FilamentSourceBinding binding(provider,
                                  [dispatcher](std::function<void()> callback) { dispatcher->post(std::move(callback)); },
                                  [&revisions](const InventorySnapshot& inventory) { revisions.emplace_back(inventory.revision); });

    dispatcher->run_all();
    CHECK(revisions == std::vector<std::string>{"new"});
}

TEST_CASE("multiACE provider binding drops queued and stale callbacks after detach", "[multiace][binding]")
{
    auto provider   = std::make_shared<RetainedCallbackProvider>(snapshot("r1"));
    auto dispatcher = std::make_shared<QueueDispatcher>();

    std::vector<std::string> revisions;
    FilamentSourceBinding binding(provider,
                                  [dispatcher](std::function<void()> callback) { dispatcher->post(std::move(callback)); },
                                  [&revisions](const InventorySnapshot& inventory) { revisions.emplace_back(inventory.revision); });

    provider->emit(snapshot("r2"));
    binding.detach();
    provider->emit_retained_stale(snapshot("r3"));
    dispatcher->run_all();

    CHECK(binding.detached());
    CHECK(revisions.empty());
}

TEST_CASE("multiACE provider binding waits for an in-flight apply before detach returns", "[multiace][binding]")
{
    auto provider = std::make_shared<RetainedCallbackProvider>(snapshot(""));

    std::mutex              gate_mutex;
    std::condition_variable gate_condition;
    bool                    apply_started = false;
    bool                    release_apply = false;
    std::thread             dispatch_thread;

    FilamentSourceBinding binding(
        provider,
        [&dispatch_thread](std::function<void()> callback) { dispatch_thread = std::thread(std::move(callback)); },
        [&](const InventorySnapshot&) {
            std::unique_lock<std::mutex> lock(gate_mutex);
            apply_started = true;
            gate_condition.notify_all();
            gate_condition.wait(lock, [&release_apply] { return release_apply; });
        });

    provider->emit(snapshot("r1"));
    {
        std::unique_lock<std::mutex> lock(gate_mutex);
        gate_condition.wait(lock, [&apply_started] { return apply_started; });
    }

    std::atomic<bool> detach_finished{false};
    std::thread detach_thread([&] {
        binding.detach();
        detach_finished = true;
    });

    provider->wait_until_unsubscribed();
    CHECK_FALSE(detach_finished.load());

    {
        std::lock_guard<std::mutex> lock(gate_mutex);
        release_apply = true;
    }
    gate_condition.notify_all();

    dispatch_thread.join();
    detach_thread.join();
    CHECK(detach_finished.load());
}

TEST_CASE("multiACE provider binding contains apply failures and recovers on a newer snapshot", "[multiace][binding]")
{
    auto provider   = std::make_shared<ManualFilamentSourceProvider>(ProviderCapabilities{}, snapshot("r1"));
    auto dispatcher = std::make_shared<QueueDispatcher>();

    std::vector<std::string> revisions;
    FilamentSourceBinding binding(provider,
                                  [dispatcher](std::function<void()> callback) { dispatcher->post(std::move(callback)); },
                                  [&revisions](const InventorySnapshot& inventory) {
                                      if (inventory.revision == "bad")
                                          throw std::runtime_error("projection failed");
                                      revisions.emplace_back(inventory.revision);
                                  });
    dispatcher->run_all();

    CHECK_NOTHROW(provider->set_inventory(snapshot("bad")));
    CHECK_NOTHROW(dispatcher->run_all());
    CHECK(binding.last_error() == "projection failed");
    CHECK(revisions == std::vector<std::string>{"r1"});

    provider->set_inventory(snapshot("r2"));
    dispatcher->run_all();
    CHECK((revisions == std::vector<std::string>{"r1", "r2"}));
    CHECK(binding.last_error().empty());
}

TEST_CASE("multiACE provider binding contains dispatcher failures", "[multiace][binding]")
{
    auto provider = std::make_shared<ManualFilamentSourceProvider>(ProviderCapabilities{}, snapshot("r1"));
    bool applied  = false;

    FilamentSourceBinding binding(provider,
                                  [](std::function<void()>) { throw std::runtime_error("dispatcher unavailable"); },
                                  [&applied](const InventorySnapshot&) { applied = true; });

    CHECK_FALSE(applied);
    CHECK(binding.last_error() == "dispatcher unavailable");
    CHECK_NOTHROW(provider->set_inventory(snapshot("r2")));
    CHECK_FALSE(applied);
    CHECK(binding.last_error() == "dispatcher unavailable");
}
