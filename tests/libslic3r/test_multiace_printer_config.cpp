#include <catch2/catch.hpp>

#include "slic3r/GUI/multiace/MultiAcePrinterConfig.hpp"

using namespace Slic3r::MultiAce;

TEST_CASE("multiACE persisted provider config round trips connection settings", "[multiace][config]")
{
    PersistedProviderConfig config;
    config.enabled                 = true;
    config.activation.service_url  = "http://192.0.2.10:7125/multiace";
    config.activation.username     = "user";
    config.activation.password     = "secret";
    config.activation.bearer_token = "token";
    config.activation.headers      = {{"X-Printer", "u1"}, {"X-Site", "lab"}};

    const nlohmann::json serialized = serialize_persisted_provider_config(config);
    const auto           parsed     = parse_persisted_provider_config(serialized);

    CHECK(parsed.enabled);
    CHECK(parsed.activation.service_url == config.activation.service_url);
    CHECK(parsed.activation.username == config.activation.username);
    CHECK(parsed.activation.password == config.activation.password);
    CHECK(parsed.activation.bearer_token == config.activation.bearer_token);
    CHECK(parsed.activation.headers == config.activation.headers);
}

TEST_CASE("multiACE persisted provider config defaults to disabled", "[multiace][config]")
{
    const auto parsed = parse_persisted_provider_config({{"version", PersistedProviderConfig::CURRENT_VERSION}});

    CHECK_FALSE(parsed.enabled);
    CHECK_FALSE(provider_activation_config_if_enabled(parsed).has_value());
}

TEST_CASE("disabled multiACE persisted config may retain connection details", "[multiace][config]")
{
    const nlohmann::json value = {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", false},
        {"service_url", "http://192.0.2.10:7125/multiace"},
        {"auth", {{"bearer_token", "token"}}},
    };

    const auto parsed = parse_persisted_provider_config(value);

    CHECK_FALSE(parsed.enabled);
    CHECK(parsed.activation.service_url == "http://192.0.2.10:7125/multiace");
    CHECK(parsed.activation.bearer_token == "token");
    CHECK_FALSE(provider_activation_config_if_enabled(parsed).has_value());
}

TEST_CASE("enabled multiACE persisted config yields activation settings", "[multiace][config]")
{
    PersistedProviderConfig config;
    config.enabled                = true;
    config.activation.service_url = "http://192.0.2.10:7125/multiace/";

    const auto activation = provider_activation_config_if_enabled(config);

    REQUIRE(activation.has_value());
    CHECK(activation->service_url == config.activation.service_url);
}

TEST_CASE("multiACE persisted config ignores unknown fields in the current schema", "[multiace][config]")
{
    const nlohmann::json value = {
        {"version", PersistedProviderConfig::CURRENT_VERSION},
        {"enabled", false},
        {"future_option", {{"mode", "automatic"}}},
    };

    CHECK_NOTHROW(parse_persisted_provider_config(value));
}

TEST_CASE("multiACE persisted config rejects unsupported schema versions", "[multiace][config]")
{
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 2}, {"enabled", false}}),
                      "unsupported multiACE persisted configuration version");
}

TEST_CASE("multiACE persisted config rejects malformed top-level values", "[multiace][config]")
{
    CHECK_THROWS_WITH(parse_persisted_provider_config(nlohmann::json::array()), "multiACE persisted configuration must be a JSON object");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"enabled", false}}),
                      "multiACE persisted configuration requires an integer version");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", "1"}}), "multiACE persisted configuration requires an integer version");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"enabled", "yes"}}),
                      "multiACE persisted enabled flag must be boolean");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"service_url", 42}}),
                      "multiACE persisted service URL must be a string");
}

TEST_CASE("multiACE persisted config rejects malformed authentication", "[multiace][config]")
{
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"auth", "secret"}}),
                      "multiACE persisted auth must be a JSON object");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"auth", {{"username", 42}}}}),
                      "multiACE persisted auth field must be a string: username");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"auth", {{"username", "user"}}}}),
                      "multiACE basic authentication requires both username and password");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"auth", {{"password", "secret"}}}}),
                      "multiACE basic authentication requires both username and password");
}

TEST_CASE("multiACE persisted config rejects malformed custom headers", "[multiace][config]")
{
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"headers", "invalid"}}),
                      "multiACE persisted headers must be a JSON object");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"headers", {{"X-Printer", 42}}}}),
                      "multiACE persisted header values must be strings");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"headers", {{"", "value"}}}}),
                      "multiACE custom header names must not be empty");
}

TEST_CASE("enabled multiACE persisted config validates its service URL before activation", "[multiace][config]")
{
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"enabled", true}}),
                      "enabled multiACE configuration requires a service URL");
    CHECK_THROWS_WITH(parse_persisted_provider_config({{"version", 1}, {"enabled", true}, {"service_url", "https://192.0.2.10/multiace"}}),
                      "multiACE HTTPS activation requires wss:// transport support");
}
