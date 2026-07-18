#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAceProviderConfig.hpp"

#include <memory>
#include <stdexcept>

using namespace Slic3r::MultiAce;

namespace {

class FakeStartedProvider
{
public:
    void stop() { ++stop_count; }

    int stop_count = 0;
};

} // namespace

TEST_CASE("multiACE activation derives matching HTTP and WebSocket service roots", "[multiace][activation]")
{
    const ProviderTransportUrls urls = provider_transport_urls("http://192.0.2.10:7125/multiace/");

    CHECK(urls.http_base_url == "http://192.0.2.10:7125/multiace");
    CHECK(urls.websocket_base_url == "ws://192.0.2.10:7125/multiace");
}

TEST_CASE("multiACE activation preserves IPv6 and nested service paths", "[multiace][activation]")
{
    const ProviderTransportUrls urls = provider_transport_urls("http://[2001:db8::10]:8080/services/multiace///");

    CHECK(urls.http_base_url == "http://[2001:db8::10]:8080/services/multiace");
    CHECK(urls.websocket_base_url == "ws://[2001:db8::10]:8080/services/multiace");
}

TEST_CASE("multiACE activation rejects ambiguous or unsupported service schemes", "[multiace][activation]")
{
    CHECK_THROWS_WITH(provider_transport_urls("192.0.2.10:7125/multiace"), "multiACE service URL must start with http://");
    CHECK_THROWS_WITH(provider_transport_urls("https://192.0.2.10/multiace"),
                      "multiACE HTTPS activation requires wss:// transport support");
}

TEST_CASE("multiACE activation rejects unusable service URL authorities", "[multiace][activation]")
{
    CHECK_THROWS_WITH(provider_transport_urls("http://user:password@192.0.2.10:7125/multiace"),
                      "multiACE WebSocket credentials must be configured separately from the URL");
    CHECK_THROWS_WITH(provider_transport_urls("http://192.0.2.10:invalid/multiace"), "multiACE WebSocket port must be numeric");
    CHECK_THROWS_WITH(provider_transport_urls("http://"), "multiACE WebSocket base URL must contain a host");
}

TEST_CASE("multiACE activation rejects service URL queries and fragments", "[multiace][activation]")
{
    CHECK_THROWS_WITH(provider_transport_urls("http://192.0.2.10:7125/multiace?token=secret"),
                      "multiACE WebSocket base URL must not contain a query or fragment");
    CHECK_THROWS_WITH(provider_transport_urls("http://192.0.2.10:7125/multiace#status"),
                      "multiACE WebSocket base URL must not contain a query or fragment");
}

TEST_CASE("multiACE activation rejects raw whitespace and control characters in service URLs", "[multiace][activation]")
{
    CHECK_THROWS_WITH(provider_transport_urls("http://192.0.2.10:7125/multi ace"),
                      "multiACE service URL must not contain whitespace or control characters");
    CHECK_THROWS_WITH(provider_transport_urls("http://192.0.2.10:7125/multiace\n"),
                      "multiACE service URL must not contain whitespace or control characters");
}

TEST_CASE("multiACE activation does not attach when provider startup fails", "[multiace][activation][lifecycle]")
{
    bool attach_called = false;
    auto provider_factory = []() -> std::shared_ptr<FakeStartedProvider> { throw std::runtime_error("startup failed"); };
    auto attach           = [&attach_called](const auto&) {
        attach_called = true;
        return 1;
    };

    CHECK_THROWS_WITH(activate_multiace_provider(provider_factory, attach), "startup failed");
    CHECK_FALSE(attach_called);
}

TEST_CASE("multiACE activation stops a started provider when attachment fails", "[multiace][activation][lifecycle]")
{
    const auto provider         = std::make_shared<FakeStartedProvider>();
    auto       provider_factory = [&provider] { return provider; };
    auto       attach           = [](const auto&) -> int { throw std::runtime_error("attachment failed"); };

    CHECK_THROWS_WITH(activate_multiace_provider(provider_factory, attach), "attachment failed");
    CHECK(provider->stop_count == 1);
}

TEST_CASE("multiACE activation retains a started provider after successful attachment", "[multiace][activation][lifecycle]")
{
    const auto provider         = std::make_shared<FakeStartedProvider>();
    auto       provider_factory = [&provider] { return provider; };
    int        binding          = 42;
    auto       attach           = [&binding](const auto&) -> int& { return binding; };

    int& result = activate_multiace_provider(provider_factory, attach);

    CHECK(&result == &binding);
    CHECK(provider->stop_count == 0);
}
