#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAcePrinterLifecycle.hpp"

#include <stdexcept>
#include <string>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

nlohmann::json enabled_config(std::string url = "http://printer.local:5000")
{
    return {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", true},
        {"service_url", std::move(url)},
    };
}

} // namespace

TEST_CASE("multiACE printer lifecycle activates enabled persisted config exactly once", "[multiace][lifecycle]")
{
    MultiAcePrinterLifecycle lifecycle;
    int                      activations = 0;
    int                      detaches    = 0;

    auto activate = [&](const std::string& machine, const ProviderActivationConfig& config) {
        CHECK(machine == "u1");
        CHECK(config.service_url == "http://printer.local:5000");
        ++activations;
    };
    auto detach = [&](const std::string&) { ++detaches; };

    CHECK(lifecycle.reconcile("u1", enabled_config(), activate, detach) == PrinterLifecycleAction::Activated);
    CHECK(lifecycle.reconcile("u1", enabled_config(), activate, detach) == PrinterLifecycleAction::Unchanged);
    CHECK(activations == 1);
    CHECK(detaches == 0);
    CHECK(lifecycle.is_tracked("u1"));
}

TEST_CASE("multiACE printer lifecycle replaces changed configuration and retries failed activation", "[multiace][lifecycle]")
{
    MultiAcePrinterLifecycle lifecycle;
    std::vector<std::string> activated_urls;
    int                      attempts = 0;

    auto activate = [&](const std::string&, const ProviderActivationConfig& config) {
        ++attempts;
        if (config.service_url == "http://new.local:5000" && attempts == 2)
            throw std::runtime_error("startup failed");
        activated_urls.push_back(config.service_url);
    };
    auto detach = [](const std::string&) {};

    REQUIRE(lifecycle.reconcile("u1", enabled_config("http://old.local:5000"), activate, detach) == PrinterLifecycleAction::Activated);
    CHECK_THROWS(lifecycle.reconcile("u1", enabled_config("http://new.local:5000"), activate, detach));
    CHECK(lifecycle.is_tracked("u1"));

    CHECK(lifecycle.reconcile("u1", enabled_config("http://new.local:5000"), activate, detach) == PrinterLifecycleAction::Activated);
    REQUIRE(activated_urls.size() == 2);
    CHECK(activated_urls[0] == "http://old.local:5000");
    CHECK(activated_urls[1] == "http://new.local:5000");
}

TEST_CASE("multiACE printer lifecycle detaches disabled or removed configuration", "[multiace][lifecycle]")
{
    MultiAcePrinterLifecycle lifecycle;
    int                      detaches = 0;

    auto activate = [](const std::string&, const ProviderActivationConfig&) {};
    auto detach   = [&](const std::string& machine) {
        CHECK(machine == "u1");
        ++detaches;
    };

    REQUIRE(lifecycle.reconcile("u1", enabled_config(), activate, detach) == PrinterLifecycleAction::Activated);

    const nlohmann::json disabled = {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", false},
        {"service_url", "http://printer.local:5000"},
    };
    CHECK(lifecycle.reconcile("u1", std::optional<nlohmann::json>{disabled}, activate, detach) == PrinterLifecycleAction::Detached);
    CHECK(detaches == 1);
    CHECK_FALSE(lifecycle.is_tracked("u1"));

    CHECK(lifecycle.reconcile("u1", std::nullopt, activate, detach) == PrinterLifecycleAction::Unchanged);
    CHECK(detaches == 1);
}

TEST_CASE("multiACE printer lifecycle fails closed for malformed persisted configuration", "[multiace][lifecycle]")
{
    MultiAcePrinterLifecycle lifecycle;
    int                      activations = 0;
    int                      detaches    = 0;

    auto activate = [&](const std::string&, const ProviderActivationConfig&) { ++activations; };
    auto detach   = [&](const std::string&) { ++detaches; };

    REQUIRE(lifecycle.reconcile("u1", enabled_config(), activate, detach) == PrinterLifecycleAction::Activated);

    const nlohmann::json malformed = {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", "yes"},
        {"service_url", "http://printer.local:5000"},
    };
    CHECK(lifecycle.reconcile("u1", std::optional<nlohmann::json>{malformed}, activate, detach) == PrinterLifecycleAction::InvalidConfig);
    CHECK(activations == 1);
    CHECK(detaches == 1);
    CHECK_FALSE(lifecycle.is_tracked("u1"));
}

TEST_CASE("multiACE printer lifecycle clears all tracked machines safely", "[multiace][lifecycle]")
{
    MultiAcePrinterLifecycle lifecycle;
    std::vector<std::string> detached;

    auto activate = [](const std::string&, const ProviderActivationConfig&) {};
    auto detach   = [&](const std::string& machine) {
        detached.push_back(machine);
        if (machine == "b")
            throw std::runtime_error("ignored during shutdown");
    };

    REQUIRE(lifecycle.reconcile("a", enabled_config("http://a.local:5000"), activate, detach) == PrinterLifecycleAction::Activated);
    REQUIRE(lifecycle.reconcile("b", enabled_config("http://b.local:5000"), activate, detach) == PrinterLifecycleAction::Activated);

    lifecycle.clear(detach);

    CHECK(lifecycle.size() == 0);
    CHECK(detached.size() == 2);
}
