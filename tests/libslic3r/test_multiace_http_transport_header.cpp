#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAceHttpTransport.hpp"

#include <type_traits>

using namespace Slic3r::MultiAce;

static_assert(std::is_base_of_v<RestTransport, HttpRestTransport>);
static_assert(std::is_final_v<HttpRestTransport>);

TEST_CASE("multiACE HTTP transport defaults are bounded", "[multiace][http]")
{
    const HttpTransportConfig config;
    CHECK(config.connect_timeout_seconds == 5);
    CHECK(config.request_timeout_seconds == 15);
    CHECK(config.response_size_limit == 2 * 1024 * 1024);
}
