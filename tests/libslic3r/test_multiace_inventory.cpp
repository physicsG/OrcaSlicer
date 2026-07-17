#include <catch2/catch.hpp>

#include "libslic3r/FilamentSourceProvider.hpp"
#include "libslic3r/MultiAceInventory.hpp"

#include "nlohmann/json.hpp"

#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace Slic3r::MultiAce;

TEST_CASE("multiACE source IDs are stable and structured", "[multiace][inventory]")
{
    const SourceId source{"multiace", "2", "3"};
    CHECK(source.str() == "multiace:2:3");
    CHECK(parse_source_id(source.str()) == source);

    CHECK_THROWS_WITH(parse_source_id("multiace:2"), "multiACE source ID must use provider:unit:slot format");
    CHECK_THROWS_WITH((SourceId{"multiace", "2:invalid", "3"}.str()), "multiACE source ID components must not contain ':'");
}

TEST_CASE("multiACE capabilities degrade cleanly when optional fields are absent", "[multiace][inventory]")
{
    const nlohmann::json payload = {
        {"schema_version", 1},
        {"capabilities", {{"inventory", true}, {"live_events", true}, {"rfid_refresh", true}}},
    };

    const ProviderCapabilities capabilities = parse_capabilities(payload);
    CHECK(capabilities.schema_version == 1);
    CHECK(capabilities.inventory);
    CHECK(capabilities.live_events);
    CHECK(capabilities.rfid_refresh);
    CHECK_FALSE(capabilities.remaining_percent);
    CHECK_FALSE(capabilities.dryer_state);
    CHECK_FALSE(capabilities.per_source_routing);
    CHECK_FALSE(capabilities.measured_change_timing);
}

TEST_CASE("multiACE capabilities require a supported schema version", "[multiace][inventory]")
{
    SECTION("missing schema version")
    {
        const nlohmann::json payload = {
            {"capabilities", {{"inventory", true}}},
        };
        CHECK_THROWS_WITH(parse_capabilities(payload), "schema_version must be an integer");
    }

    SECTION("unsupported schema version")
    {
        const nlohmann::json payload = {
            {"schema_version", 2},
            {"capabilities", {{"inventory", true}}},
        };
        CHECK_THROWS_WITH(parse_capabilities(payload), "unsupported multiACE schema_version: 2");
    }
}

TEST_CASE("multiACE inventory parses multiple units and optional telemetry", "[multiace][inventory]")
{
    const nlohmann::json payload = nlohmann::json::parse(R"json(
        {
          "schema_version": 1,
          "revision": "inventory-42",
          "sources": [
            {
              "source_id": "multiace:0:0",
              "unit_id": 0,
              "slot_id": 0,
              "rfid_uid": "rfid-a",
              "material": "PLA",
              "subtype": "PLA Basic",
              "brand": "Snapmaker",
              "color": "#D52332",
              "remaining_percent": 72,
              "metadata_origin": "rfid",
              "state": "ready",
              "reachable_toolheads": [2, 0, 2],
              "loaded_toolhead": 0,
              "humidity_percent": 34,
              "temperature_c": 31.5,
              "dryer_state": "drying",
              "dryer_remaining_minutes": 45
            },
            {
              "unit_id": "1",
              "slot_id": "3",
              "tag_uid": "manual-tag",
              "material": "PETG",
              "metadata_origin": "manual",
              "state": "offline",
              "reachable_toolheads": [3],
              "loaded_toolhead": null,
              "dryer_active": false
            }
          ]
        }
    )json");

    const InventorySnapshot inventory = parse_inventory(payload);
    REQUIRE(inventory.schema_version == 1);
    REQUIRE(inventory.revision == "inventory-42");
    REQUIRE(inventory.sources.size() == 2);

    const FilamentSource& first = inventory.sources[0];
    CHECK(first.id.str() == "multiace:0:0");
    CHECK(first.rfid_uid == "rfid-a");
    CHECK(first.material == "PLA");
    CHECK(first.subtype == "PLA Basic");
    CHECK(first.brand == "Snapmaker");
    CHECK(first.color == "#D52332");
    REQUIRE(first.remaining_percent.has_value());
    CHECK(*first.remaining_percent == 72);
    CHECK(first.metadata_origin == SourceMetadataOrigin::RFID);
    CHECK(first.state == SourceState::Ready);
    const std::vector<int> expected_toolheads{0, 2};
    CHECK(first.reachable_toolheads == expected_toolheads);
    REQUIRE(first.loaded_toolhead.has_value());
    CHECK(*first.loaded_toolhead == 0);
    REQUIRE(first.humidity_percent.has_value());
    CHECK(*first.humidity_percent == 34);
    REQUIRE(first.temperature_c.has_value());
    CHECK(*first.temperature_c == Approx(31.5));
    CHECK(first.dryer_state == DryerState::Drying);
    REQUIRE(first.dryer_remaining_minutes.has_value());
    CHECK(*first.dryer_remaining_minutes == 45);

    const FilamentSource& second = inventory.sources[1];
    CHECK(second.id.str() == "multiace:1:3");
    CHECK(second.rfid_uid == "manual-tag");
    CHECK(second.metadata_origin == SourceMetadataOrigin::Manual);
    CHECK(second.state == SourceState::Offline);
    CHECK(second.dryer_state == DryerState::Off);
    CHECK_FALSE(second.loaded_toolhead.has_value());
    CHECK_FALSE(second.remaining_percent.has_value());
}

TEST_CASE("multiACE inventory rejects malformed and inconsistent payloads", "[multiace][inventory]")
{
    SECTION("unsupported schema")
    {
        const nlohmann::json payload = {
            {"schema_version", 2},
            {"revision", "r1"},
            {"sources", nlohmann::json::array()},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "unsupported multiACE schema_version: 2");
    }

    SECTION("source ID mismatch")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {{"source_id", "multiace:0:1"}, {"unit_id", 0}, {"slot_id", 0}},
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "source_id does not match unit_id and slot_id");
    }

    SECTION("duplicate source")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {{"unit_id", 0}, {"slot_id", 0}},
                            {{"unit_id", "0"}, {"slot_id", "0"}},
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "duplicate multiACE source_id: multiace:0:0");
    }

    SECTION("negative numeric source index")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {{"unit_id", -1}, {"slot_id", 0}},
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "source.unit_id must not be negative");
    }

    SECTION("invalid physical toolhead")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {{"unit_id", 0}, {"slot_id", 0}, {"reachable_toolheads", {4}}},
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "reachable_toolheads contains an invalid U1 toolhead");
    }

    SECTION("loaded toolhead is not reachable")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {
                                {"unit_id", 0},
                                {"slot_id", 0},
                                {"reachable_toolheads", {0, 2}},
                                {"loaded_toolhead", 1},
                            },
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "loaded_toolhead must be included in reachable_toolheads");
    }

    SECTION("oversized bounded integer")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {
                                {"unit_id", 0},
                                {"slot_id", 0},
                                {"remaining_percent", std::numeric_limits<unsigned long long>::max()},
                            },
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "remaining_percent is outside the supported range");
    }

    SECTION("unsigned integer below a positive minimum")
    {
        const nlohmann::json payload = {{"value", 0U}};
        CHECK_THROWS_WITH(detail::optional_bounded_integer(payload, "value", 1, 10), "value is outside the supported range");
    }

    SECTION("non-finite telemetry")
    {
        const nlohmann::json payload = {
            {"schema_version", 1},
            {"revision", "r1"},
            {"sources", nlohmann::json::array({
                            {
                                {"unit_id", 0},
                                {"slot_id", 0},
                                {"temperature_c", std::numeric_limits<double>::infinity()},
                            },
                        })},
        };
        CHECK_THROWS_WITH(parse_inventory(payload), "temperature_c must be finite");
    }
}

TEST_CASE("multiACE parser preserves forward compatibility for unknown states", "[multiace][inventory]")
{
    const nlohmann::json payload = {
        {"schema_version", 1},
        {"revision", "r1"},
        {"sources", nlohmann::json::array({
                        {
                            {"unit_id", 0},
                            {"slot_id", 0},
                            {"state", "future-state"},
                            {"metadata_origin", "future-origin"},
                            {"dryer_state", "future-dryer-state"},
                        },
                    })},
    };

    const InventorySnapshot inventory = parse_inventory(payload);
    REQUIRE(inventory.sources.size() == 1);
    CHECK(inventory.sources[0].state == SourceState::Unknown);
    CHECK(inventory.sources[0].metadata_origin == SourceMetadataOrigin::Unknown);
    CHECK(inventory.sources[0].dryer_state == DryerState::Unknown);
}

TEST_CASE("manual filament source provider supports offline snapshots and callbacks", "[multiace][provider]")
{
    ProviderCapabilities capabilities;
    capabilities.inventory    = true;
    capabilities.rfid_refresh = true;

    ManualFilamentSourceProvider provider(capabilities);

    std::vector<std::string> callback_revisions;
    provider.subscribe([&callback_revisions](const InventorySnapshot& snapshot) {
        callback_revisions.emplace_back(snapshot.revision);
        REQUIRE(snapshot.sources.size() == 1);
        CHECK(snapshot.sources[0].id.str() == "multiace:0:2");
    });

    SourceId refresh_source;
    provider.set_refresh_callback([&refresh_source](const SourceId& source) { refresh_source = source; });

    InventorySnapshot snapshot;
    snapshot.revision = "manual-1";
    FilamentSource source;
    source.id    = SourceId{"multiace", "0", "2"};
    source.state = SourceState::Offline;
    snapshot.sources.emplace_back(source);

    provider.set_inventory(snapshot);
    snapshot.revision = "manual-2";
    provider.set_inventory(snapshot);

    REQUIRE(callback_revisions.size() == 2);
    CHECK(callback_revisions[0] == "manual-1");
    CHECK(callback_revisions[1] == "manual-2");
    CHECK(provider.inventory().revision == "manual-2");
    CHECK(provider.capabilities().rfid_refresh);

    provider.request_metadata_refresh(source.id);
    CHECK(refresh_source == source.id);
}

TEST_CASE("manual provider serializes reentrant updates and recovers from callback failures", "[multiace][provider]")
{
    ManualFilamentSourceProvider provider;
    std::vector<std::string>     primary_revisions;
    std::vector<std::string>     secondary_revisions;

    provider.subscribe([&](const InventorySnapshot& snapshot) {
        primary_revisions.emplace_back(snapshot.revision);
        if (snapshot.revision == "manual-1") {
            InventorySnapshot nested = snapshot;
            nested.revision          = "manual-2";
            provider.set_inventory(std::move(nested));
        }
    });
    provider.subscribe([&](const InventorySnapshot& snapshot) {
        secondary_revisions.emplace_back(snapshot.revision);
        if (snapshot.revision == "manual-1")
            throw std::runtime_error("callback failure");
    });

    InventorySnapshot snapshot;
    snapshot.revision = "manual-1";

    CHECK_THROWS_WITH(provider.set_inventory(snapshot), "callback failure");
    CHECK(primary_revisions == std::vector<std::string>{"manual-1", "manual-2"});
    CHECK(secondary_revisions == std::vector<std::string>{"manual-1", "manual-2"});

    snapshot.revision = "manual-3";
    CHECK_NOTHROW(provider.set_inventory(snapshot));
    CHECK(primary_revisions.back() == "manual-3");
    CHECK(secondary_revisions.back() == "manual-3");
}
