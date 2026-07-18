#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAceProviderActivation.hpp"

using namespace Slic3r::MultiAce;

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
