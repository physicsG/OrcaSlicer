#include <catch2/catch.hpp>

#include "libslic3r/MultiAceWebPayload.hpp"

#include "nlohmann/json.hpp"

#include <algorithm>
#include <fstream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace Slic3r::MultiAce;

namespace {

nlohmann::json fixture(const std::string& name)
{
    std::ifstream input(std::string(TEST_DATA_DIR) + "/multiace/" + name);
    if (!input)
        throw std::runtime_error("failed to open multiACE fixture: " + name);
    return nlohmann::json::parse(input);
}

const FilamentSource& source(const InventorySnapshot& inventory, const char* id)
{
    const auto found = std::find_if(inventory.sources.begin(), inventory.sources.end(),
                                    [&id](const FilamentSource& candidate) { return candidate.id.str() == id; });
    if (found == inventory.sources.end())
        throw std::runtime_error(std::string("fixture source not found: ") + id);
    return *found;
}

} // namespace

TEST_CASE("multiACE Web version advertises the deployed service capabilities", "[multiace][web-contract]")
{
    const ProviderCapabilities capabilities = parse_multiace_web_capabilities({
        {"web", "0.99.5b"},
        {"moonraker_url", "http://127.0.0.1:7125"},
    });

    CHECK(capabilities.inventory);
    CHECK(capabilities.live_events);
    CHECK(capabilities.dryer_state);
    CHECK(capabilities.per_source_routing);
    CHECK_FALSE(capabilities.rfid_refresh);
    CHECK_FALSE(capabilities.remaining_percent);
    CHECK_FALSE(capabilities.measured_change_timing);

    CHECK_THROWS_WITH(parse_multiace_web_capabilities({{"moonraker_url", "http://127.0.0.1:7125"}}),
                      "multiACE Web version payload requires a non-empty web version");
}

TEST_CASE("multiACE Web state maps multiple ACE units into stable sources", "[multiace][web-contract]")
{
    const nlohmann::json    payload   = fixture("multiace_web_state_v0.99.5b.json");
    const InventorySnapshot inventory = parse_multiace_web_inventory(payload);

    REQUIRE(inventory.sources.size() == 8);
    CHECK(inventory.revision.rfind("multiace-web:", 0) == 0);
    CHECK(inventory.revision.size() == 29);

    const FilamentSource& rfid = source(inventory, "multiace:0:0");
    CHECK(rfid.material == "PLA");
    CHECK(rfid.subtype == "PLA Basic");
    CHECK(rfid.brand == "Anycubic");
    CHECK(rfid.color == "#f4f3ef");
    CHECK(rfid.metadata_origin == SourceMetadataOrigin::RFID);
    CHECK(rfid.state == SourceState::Ready);
    CHECK(rfid.reachable_toolheads == std::vector<int>{0});
    REQUIRE(rfid.humidity_percent);
    CHECK(*rfid.humidity_percent == 34);
    REQUIRE(rfid.temperature_c);
    CHECK(*rfid.temperature_c == Approx(31.5));
    CHECK(rfid.dryer_state == DryerState::Drying);
    REQUIRE(rfid.dryer_remaining_minutes);
    CHECK(*rfid.dryer_remaining_minutes == 45);

    const FilamentSource& manual = source(inventory, "multiace:0:1");
    CHECK(manual.metadata_origin == SourceMetadataOrigin::Manual);
    CHECK(manual.state == SourceState::Loading);
    CHECK(manual.reachable_toolheads == std::vector<int>{1});
    REQUIRE(manual.loaded_toolhead);
    CHECK(*manual.loaded_toolhead == 1);

    const FilamentSource& second_unit = source(inventory, "multiace:1:0");
    REQUIRE(second_unit.loaded_toolhead);
    CHECK(*second_unit.loaded_toolhead == 0);
    CHECK(second_unit.reachable_toolheads == std::vector<int>{0});
    CHECK(second_unit.dryer_state == DryerState::Off);
}

TEST_CASE("multiACE Web revisions track routing identity without changing for live telemetry", "[multiace][web-contract]")
{
    nlohmann::json first    = fixture("multiace_web_state_v0.99.5b.json");
    nlohmann::json second   = first;
    second["ts"]            = first.at("ts").get<double>() + 30.0;
    second["printer_state"] = "printing";

    const InventorySnapshot first_inventory  = parse_multiace_web_inventory(first);
    const InventorySnapshot second_inventory = parse_multiace_web_inventory(second);
    CHECK(first_inventory == second_inventory);

    second["aces"][0]["temp"]                   = 32.25;
    const InventorySnapshot telemetry_inventory = parse_multiace_web_inventory(second);
    CHECK(telemetry_inventory != first_inventory);
    CHECK(telemetry_inventory.revision == first_inventory.revision);

    second["aces"][0]["slots"][0]["material"] = "PETG";
    const InventorySnapshot changed_inventory = parse_multiace_web_inventory(second);
    CHECK(changed_inventory.revision != first_inventory.revision);
}

TEST_CASE("multiACE Web ACE-per-head mode routes every unit slot to its configured U1 head", "[multiace][web-contract]")
{
    const InventorySnapshot inventory = parse_multiace_web_inventory(fixture("multiace_web_event_head_mode_v0.99.5b.json"));

    REQUIRE(inventory.sources.size() == 8);
    for (const FilamentSource& filament_source : inventory.sources) {
        const std::vector<int> expected = filament_source.id.unit_id == "0" ? std::vector<int>{1} : std::vector<int>{3};
        CHECK(filament_source.reachable_toolheads == expected);
    }

    const FilamentSource& first_loaded = source(inventory, "multiace:0:2");
    REQUIRE(first_loaded.loaded_toolhead);
    CHECK(*first_loaded.loaded_toolhead == 1);

    const FilamentSource& second_loaded = source(inventory, "multiace:1:0");
    REQUIRE(second_loaded.loaded_toolhead);
    CHECK(*second_loaded.loaded_toolhead == 3);
}

TEST_CASE("multiACE Web head mode does not guess routes without an explicit ACE mapping", "[multiace][web-contract]")
{
    const nlohmann::json payload = {
        {"mode", "head"},
        {"ace_heads", {3}},
        {"aces", nlohmann::json::array({
                     {
                         {"idx", 0},
                         {"slots", nlohmann::json::array({{{"idx", 0}, {"state", "ready"}}})},
                     },
                 })},
    };

    const InventorySnapshot inventory = parse_multiace_web_inventory(payload);
    REQUIRE(inventory.sources.size() == 1);
    CHECK(inventory.sources.front().reachable_toolheads.empty());
}

TEST_CASE("multiACE Web disconnected units retain metadata while becoming offline", "[multiace][web-contract]")
{
    nlohmann::json payload          = fixture("multiace_web_state_v0.99.5b.json");
    payload["aces"][1]["connected"] = false;

    const InventorySnapshot inventory = parse_multiace_web_inventory(payload);
    for (const FilamentSource& filament_source : inventory.sources) {
        if (filament_source.id.unit_id == "1")
            CHECK(filament_source.state == SourceState::Offline);
    }
    CHECK(source(inventory, "multiace:1:0").material == "PLA");
    CHECK(source(inventory, "multiace:1:0").color == "#d52332");
}

TEST_CASE("multiACE Web optional telemetry degrades without inventing values", "[multiace][web-contract]")
{
    const nlohmann::json payload = {
        {"mode", "unknown-future-mode"},
        {"aces", nlohmann::json::array({
                     {
                         {"idx", 7},
                         {"slots", nlohmann::json::array({
                                       {{"idx", 9}, {"state", "future-state"}, {"material", "PLA"}},
                                   })},
                     },
                 })},
    };

    const InventorySnapshot inventory = parse_multiace_web_inventory(payload);
    REQUIRE(inventory.sources.size() == 1);
    const FilamentSource& filament_source = inventory.sources.front();
    CHECK(filament_source.id.str() == "multiace:7:9");
    CHECK(filament_source.state == SourceState::Unknown);
    CHECK(filament_source.metadata_origin == SourceMetadataOrigin::Unknown);
    CHECK(filament_source.reachable_toolheads.empty());
    CHECK_FALSE(filament_source.loaded_toolhead);
    CHECK_FALSE(filament_source.humidity_percent);
    CHECK_FALSE(filament_source.temperature_c);
    CHECK(filament_source.dryer_state == DryerState::Unknown);
}

TEST_CASE("multiACE Web rejects malformed routing and service failures", "[multiace][web-contract]")
{
    SECTION("invalid physical toolhead")
    {
        nlohmann::json payload         = fixture("multiace_web_state_v0.99.5b.json");
        payload["toolheads"][0]["idx"] = 4;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "multiACE Web toolhead.idx contains an invalid U1 toolhead");
    }

    SECTION("loaded source does not exist")
    {
        nlohmann::json payload         = fixture("multiace_web_state_v0.99.5b.json");
        payload["toolheads"][0]["ace"] = 99;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "multiACE Web toolhead references an unknown ACE source");
    }

    SECTION("known loaded source requires coordinates")
    {
        nlohmann::json payload         = fixture("multiace_web_state_v0.99.5b.json");
        payload["toolheads"][0]["ace"] = nullptr;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "multiACE Web toolhead source requires both ace and slot");
    }

    SECTION("unused head mapping is still validated")
    {
        nlohmann::json payload   = fixture("multiace_web_event_head_mode_v0.99.5b.json");
        payload["head_ace"]["4"] = 9;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "multiACE Web head_ace contains an invalid U1 toolhead");
    }

    SECTION("normalized duplicate head mappings are rejected")
    {
        nlohmann::json payload    = fixture("multiace_web_event_head_mode_v0.99.5b.json");
        payload["head_ace"]["01"] = 1;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "duplicate multiACE Web head_ace key: 1");
    }

    SECTION("duplicate slot")
    {
        nlohmann::json payload                = fixture("multiace_web_state_v0.99.5b.json");
        payload["aces"][0]["slots"][1]["idx"] = 0;
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "duplicate multiACE Web slot.idx in ACE 0: 0");
    }

    SECTION("Klippy disconnected")
    {
        const nlohmann::json payload = {{"type", "state"}, {"klippy", "disconnected"}};
        CHECK(multiace_web_reports_disconnected(payload));
        CHECK_THROWS_WITH(parse_multiace_web_inventory(payload), "multiACE Web reports that Klippy is disconnected");
    }

    SECTION("service error")
    {
        CHECK_THROWS_WITH(parse_multiace_web_inventory({{"error", "moonraker unavailable"}}),
                          "multiACE Web state request failed: moonraker unavailable");
    }
}
