#include <catch2/catch.hpp>

#include "libslic3r/AceMmuState.hpp"

#include <fstream>
#include <sstream>

using namespace Slic3r::AceMmu;

static std::string load_fixture(const std::string& name)
{
    const std::string path = std::string(TEST_DATA_DIR) + "/ace_mmu/" + name;
    std::ifstream     in(path, std::ios::binary);
    REQUIRE(in.good());
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

TEST_CASE("colour string converts to RRGGBBAA", "[ace_mmu]")
{
    CHECK(ace_color_to_rrggbbaa("#83afff") == "83AFFFFF");
    CHECK(ace_color_to_rrggbbaa("83afff") == "83AFFFFF");
    CHECK(ace_color_to_rrggbbaa("#FF0000") == "FF0000FF");
    CHECK(ace_color_to_rrggbbaa("").empty());
    CHECK(ace_color_to_rrggbbaa("#nothex").empty());
    CHECK(ace_color_to_rrggbbaa("#12345").empty());
}

TEST_CASE("parse live /api/state fixture into an AceSnapshot", "[ace_mmu]")
{
    const AceSnapshot snap = parse_ace_state(load_fixture("state_live_v0.99.6.1b.json"));

    // Top level, as captured from the printer (multiACE 0.99.6.1b).
    CHECK(snap.device_count == 1);
    CHECK(snap.active_device == 0);
    CHECK(snap.mode == "head");
    CHECK(snap.printer_state == "idle");
    CHECK(snap.ace_status == "ready"); // string on real firmware, not an int
    REQUIRE(snap.ace_temp.has_value());
    CHECK(*snap.ace_temp == 31.0); // 31 is exactly representable; no Approx (repo test guide)

    REQUIRE(snap.units.size() == 1);
    const AceUnit& u = snap.units.front();
    CHECK(u.idx == 0);
    CHECK(u.connected);
    CHECK(u.protocol == "v2"); // ACE 2 Pro
    REQUIRE(u.humidity.has_value());
    CHECK(*u.humidity == 49); // raw percent, NOT a 1..5 bucket

    REQUIRE(u.slots.size() == 4);

    // Slot 0: loaded PETG, silver, identity from an override.
    const AceSlot& s0 = u.slots[0];
    CHECK(s0.idx == 0);
    CHECK(s0.occupied);
    CHECK(s0.state == "ready");
    CHECK(s0.material == "PETG");
    CHECK(s0.brand == "Kingroon");
    CHECK(s0.color_rrggbb == "#83afff");
    CHECK(ace_color_to_rrggbbaa(s0.color_rrggbb) == "83AFFFFF");
    CHECK(s0.source == "override");
    CHECK(s0.identity_trusted());

    // Slots 1 and 2 are empty.
    CHECK_FALSE(u.slots[1].occupied);
    CHECK(u.slots[1].state == "empty");
    CHECK_FALSE(u.slots[2].occupied);

    // Slot 3: loaded PETG, grey.
    const AceSlot& s3 = u.slots[3];
    CHECK(s3.idx == 3);
    CHECK(s3.occupied);
    CHECK(s3.material == "PETG");
    CHECK(ace_color_to_rrggbbaa(s3.color_rrggbb) == "8FA7C8FF");
}

TEST_CASE("occupancy uses both state and gate_status", "[ace_mmu]")
{
    const auto snap = parse_ace_state(std::string(R"({
        "device_count": 1,
        "aces": [{
            "idx": 0, "connected": true,
            "slots": [
                {"idx": 0, "state": "ready",  "raw": 1},
                {"idx": 1, "state": "ready",  "raw": 0},
                {"idx": 2, "state": "empty",  "raw": 1},
                {"idx": 3, "state": "loading"}
            ]
        }]
    })"));

    REQUIRE(snap.units.size() == 1);
    const auto& s = snap.units.front().slots;
    REQUIRE(s.size() == 4);
    CHECK(s[0].occupied);       // ready + gate present
    CHECK_FALSE(s[1].occupied); // gate reads empty
    CHECK_FALSE(s[2].occupied); // state empty
    CHECK(s[3].occupied);       // non-empty state, gate unknown -> occupied
}

TEST_CASE("device_count falls back to the aces array length", "[ace_mmu]")
{
    const auto snap = parse_ace_state(std::string(R"({
        "aces": [ {"idx": 0, "connected": true}, {"idx": 1, "connected": false} ]
    })"));
    CHECK(snap.device_count == 2);
    CHECK(snap.units.size() == 2);
}

TEST_CASE("malformed payloads degrade to an empty snapshot", "[ace_mmu]")
{
    CHECK(parse_ace_state(std::string("not json")).units.empty());
    CHECK(parse_ace_state(std::string("[]")).units.empty());
    CHECK(parse_ace_state(std::string("{}")).device_count == 0);
}
