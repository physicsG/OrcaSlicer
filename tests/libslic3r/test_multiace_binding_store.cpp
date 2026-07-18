#include <catch2/catch.hpp>

#include "libslic3r/MultiAceBindingStore.hpp"

#include <algorithm>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using Slic3r::MultiAce::BasicMultiAceBindingStore;

namespace {

struct FakeMachine
{};

class FakeBinding
{
public:
    FakeBinding(std::vector<std::string>& events, std::string name, bool throw_on_detach = false)
        : m_events(events), m_name(std::move(name)), m_throw_on_detach(throw_on_detach)
    {
        m_events.emplace_back("construct:" + m_name);
    }

    ~FakeBinding() { m_events.emplace_back("destroy:" + m_name); }

    void detach()
    {
        m_events.emplace_back("detach:" + m_name);
        if (m_throw_on_detach)
            throw std::runtime_error("detach failed");
    }

private:
    std::vector<std::string>& m_events;
    std::string               m_name;
    bool                      m_throw_on_detach;
};

using Store = BasicMultiAceBindingStore<FakeMachine, FakeBinding>;

} // namespace

TEST_CASE("multiACE binding store replaces a provider only after detaching the old binding", "[multiace][binding][lifecycle]")
{
    std::vector<std::string> events;
    FakeMachine              machine;
    Store                    store;

    store.attach(machine, [&] { return std::make_unique<FakeBinding>(events, "first"); });
    REQUIRE(store.get(machine) != nullptr);

    store.attach(machine, [&] {
        CHECK(store.get(machine) == nullptr);
        return std::make_unique<FakeBinding>(events, "second");
    });

    CHECK(store.size() == 1);
    CHECK(store.get(machine) != nullptr);
    CHECK(events == std::vector<std::string>{"construct:first", "detach:first", "destroy:first", "construct:second"});
}

TEST_CASE("multiACE binding store detaches every binding before machine shutdown", "[multiace][binding][lifecycle]")
{
    std::vector<std::string> events;
    FakeMachine              first;
    FakeMachine              second;
    Store                    store;

    store.attach(first, [&] { return std::make_unique<FakeBinding>(events, "first"); });
    store.attach(second, [&] { return std::make_unique<FakeBinding>(events, "second"); });

    store.detach_all();
    events.emplace_back("destroy-machines");

    CHECK(store.size() == 0);
    const auto shutdown = std::find(events.begin(), events.end(), "destroy-machines");
    for (const std::string name : {"first", "second"}) {
        const auto constructed = std::find(events.begin(), events.end(), "construct:" + name);
        const auto detached    = std::find(events.begin(), events.end(), "detach:" + name);
        const auto destroyed   = std::find(events.begin(), events.end(), "destroy:" + name);
        CHECK(constructed < detached);
        CHECK(detached < destroyed);
        CHECK(destroyed < shutdown);
    }
}

TEST_CASE("multiACE binding store contains detach failures during cleanup", "[multiace][binding][lifecycle]")
{
    std::vector<std::string> events;
    FakeMachine              machine;
    Store                    store;

    store.attach(machine, [&] { return std::make_unique<FakeBinding>(events, "throwing", true); });

    CHECK_NOTHROW(store.detach(machine));
    CHECK(store.get(machine) == nullptr);
    CHECK(events == std::vector<std::string>{"construct:throwing", "detach:throwing", "destroy:throwing"});
}

TEST_CASE("multiACE binding store stays empty when replacement construction fails", "[multiace][binding][lifecycle]")
{
    std::vector<std::string> events;
    FakeMachine              machine;
    Store                    store;

    store.attach(machine, [&] { return std::make_unique<FakeBinding>(events, "first"); });

    CHECK_THROWS_AS(store.attach(machine, []() -> std::unique_ptr<FakeBinding> { throw std::runtime_error("construction failed"); }),
                    std::runtime_error);
    CHECK(store.get(machine) == nullptr);
    CHECK(events == std::vector<std::string>{"construct:first", "detach:first", "destroy:first"});
}
