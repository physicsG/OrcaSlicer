#include <catch2/catch.hpp>

#include "libslic3r/AceMmuTopology.hpp"

using namespace Slic3r;
using namespace Slic3r::AceMmu;

// The live U1 at 192.168.2.242, read 22 Aug 2026: mode "head", one connected ACE 2 Pro at 38% RH
// feeding Toolhead 4 from slot 2, three heads on their own feeders, four PETG spools.
//
// head_ace is the trap this fixture exists for. The machine reports {"0":0,"1":1,"2":2,"3":0} with
// exactly ONE unit plugged in, so reading it as wiring invents units 1 and 2. Only head 3 is
// actually ACE-fed, and `feeder` is what says so.
static const char *LIVE_HEAD_MODE = R"({
  "device_count": 1,
  "active_device": 0,
  "ace_head": 3,
  "mode": "head",
  "printer_state": "idle",
  "ace_status": "ready",
  "ace_temp": 29,
  "head_ace": { "0": 0, "1": 1, "2": 2, "3": 0 },
  "aces": [
    {
      "idx": 0, "connected": true, "protocol": "v2", "status": "ready",
      "temp": 29, "humidity": 38,
      "dryer": { "status": "stop", "target_temp": 0, "duration": 0, "remain_time": 0 },
      "slots": [
        { "idx": 0, "state": "ready", "raw": 1, "rfid": 0, "material": "PETG",
          "brand": "Kingroon", "sku": "", "subtype": "Basic", "color": "#83AFFF", "source": "override" },
        { "idx": 1, "state": "ready", "raw": 1, "rfid": 0, "material": "PETG",
          "brand": "Kingroon", "sku": "", "subtype": "Basic", "color": "#8FA7C8", "source": "override" },
        { "idx": 2, "state": "ready", "raw": 1, "rfid": 0, "material": "PETG",
          "brand": "Generic", "sku": "", "subtype": "Basic", "color": "#632c2c", "source": "override" },
        { "idx": 3, "state": "ready", "raw": 1, "rfid": 0, "material": "PETG",
          "brand": "Kingroon", "sku": "", "subtype": "Basic", "color": "#C47053", "source": "override" }
      ]
    }
  ],
  "toolheads": [
    { "idx": 0, "ace": null, "slot": null, "material": "PLA", "color": "#f44336",
      "filament_detected": true, "manual": false, "feeder": true, "source": null },
    { "idx": 1, "ace": null, "slot": null, "material": "PLA", "color": "#ffffdc",
      "filament_detected": true, "manual": false, "feeder": true, "source": null },
    { "idx": 2, "ace": null, "slot": null, "material": "", "color": "#ffffff",
      "filament_detected": false, "manual": false, "feeder": true, "source": null },
    { "idx": 3, "ace": 0, "slot": 2, "material": "PETG", "color": "#632c2c",
      "filament_detected": true, "manual": false, "feeder": false, "source": null }
  ]
})";

// A printer preset carries these three keys and nothing else this code reads.
static DynamicConfig preset_with(AceMode mode, std::vector<int> units, std::vector<int> caps)
{
    DynamicConfig cfg;
    cfg.set_key_value("ace_mode", new ConfigOptionEnum<AceMode>(mode));
    cfg.set_key_value("ace_head_unit", new ConfigOptionInts(std::move(units)));
    cfg.set_key_value("ace_head_capacity", new ConfigOptionInts(std::move(caps)));
    return cfg;
}

TEST_CASE("ace_mode_from_string takes the firmware's own words", "[AceMmuTopology]")
{
    REQUIRE(ace_mode_from_string("normal") == amNormal);
    REQUIRE(ace_mode_from_string("head") == amHead);
    REQUIRE(ace_mode_from_string("multi") == amMulti);
    // A word we do not know claims no ACE rather than guessing one.
    REQUIRE(ace_mode_from_string("") == amNormal);
    REQUIRE(ace_mode_from_string("something-new") == amNormal);
}

TEST_CASE("the live U1 maps to one ACE-fed head and three feeders", "[AceMmuTopology]")
{
    const AceSnapshot snap = parse_ace_state(std::string(LIVE_HEAD_MODE));
    REQUIRE(snap.mode == "head");
    REQUIRE(snap.device_count == 1);
    REQUIRE(snap.toolheads.size() == 4);

    const AceTopology topo = ace_topology_of(snap, 4);
    REQUIRE(topo.mode == amHead);
    REQUIRE(topo.unit == std::vector<int>{-1, -1, -1, 0});
    REQUIRE(topo.cap == std::vector<int>{1, 1, 1, 4});
}

TEST_CASE("head_ace never turns a stock feeder into a unit", "[AceMmuTopology]")
{
    // The regression this file exists for: head_ace names a unit for all four heads, but three of
    // them are feeders and only one ACE is plugged in.
    const AceSnapshot snap = parse_ace_state(std::string(LIVE_HEAD_MODE));
    for (size_t h = 0; h < 3; ++h)
        REQUIRE(snap.toolheads[h].ace.has_value()); // parse_ace_state did fill it in from head_ace

    const AceTopology topo = ace_topology_of(snap, 4);
    for (size_t h = 0; h < 3; ++h) {
        REQUIRE(topo.unit[h] == -1);
        REQUIRE(topo.cap[h] == 1);
    }
}

TEST_CASE("capacity follows the unit's own slot list", "[AceMmuTopology]")
{
    const AceSnapshot snap = parse_ace_state(std::string(LIVE_HEAD_MODE));
    REQUIRE(ace_unit_capacity(snap, 0) == 4);
    // A unit the machine never mentioned still offers the protocol's four.
    REQUIRE(ace_unit_capacity(snap, 3) == SLOT_COUNT);
}

TEST_CASE("a head with more heads than the machine reports falls back to its feeder", "[AceMmuTopology]")
{
    // A preset for a four-head machine read against a snapshot that only described two.
    const AceSnapshot snap  = parse_ace_state(std::string(R"({"mode":"head","toolheads":[
        {"idx":0,"ace":1,"feeder":false},{"idx":1,"feeder":true}]})"));
    const AceTopology topo = ace_topology_of(snap, 4);
    REQUIRE(topo.unit == std::vector<int>{1, -1, -1, -1});
    REQUIRE(topo.cap == std::vector<int>{4, 1, 1, 1});
}

TEST_CASE("normal mode wires nothing", "[AceMmuTopology]")
{
    const AceSnapshot snap = parse_ace_state(std::string(R"({"mode":"normal","device_count":1,
        "toolheads":[{"idx":0,"feeder":true},{"idx":1,"feeder":true}]})"));
    const AceTopology topo = ace_topology_of(snap, 2);
    REQUIRE(topo.mode == amNormal);
    REQUIRE(topo.unit == std::vector<int>{-1, -1});
    REQUIRE(topo.cap == std::vector<int>{1, 1});
}

TEST_CASE("one unit may feed two heads", "[AceMmuTopology]")
{
    // ACE_SET_HEAD_ACE binds a head to a unit and says nothing about the reverse, so this is legal
    // and both heads read the same unit at its full capacity.
    const AceSnapshot snap = parse_ace_state(std::string(R"({"mode":"head","device_count":1,
        "aces":[{"idx":0,"connected":true,"protocol":"v2","slots":[
            {"idx":0,"state":"ready","raw":1},{"idx":1,"state":"ready","raw":1},
            {"idx":2,"state":"ready","raw":1},{"idx":3,"state":"ready","raw":1}]}],
        "toolheads":[{"idx":0,"ace":0,"feeder":false},{"idx":1,"ace":0,"feeder":false}]})"));
    const AceTopology topo = ace_topology_of(snap, 2);
    REQUIRE(topo.unit == std::vector<int>{0, 0});
    REQUIRE(topo.cap == std::vector<int>{4, 4});
}

TEST_CASE("ace_head_agrees is the corner tick's whole claim", "[AceMmuTopology]")
{
    const AceSnapshot snap = parse_ace_state(std::string(LIVE_HEAD_MODE));
    const AceTopology topo = ace_topology_of(snap, 4);

    SECTION("a preset written by the sync agrees on every head") {
        const DynamicConfig cfg = preset_with(amHead, topo.unit, topo.cap);
        for (size_t h = 0; h < 4; ++h)
            REQUIRE(ace_head_agrees(cfg, topo, h));
    }

    SECTION("the wrong mode disagrees on every head, whatever the wiring says") {
        const DynamicConfig cfg = preset_with(amNormal, topo.unit, topo.cap);
        for (size_t h = 0; h < 4; ++h)
            REQUIRE_FALSE(ace_head_agrees(cfg, topo, h));
    }

    SECTION("only the head that moved loses its tick") {
        const DynamicConfig cfg = preset_with(amHead, {-1, -1, -1, 1}, {1, 1, 1, 4});
        REQUIRE(ace_head_agrees(cfg, topo, 0));
        REQUIRE(ace_head_agrees(cfg, topo, 1));
        REQUIRE(ace_head_agrees(cfg, topo, 2));
        REQUIRE_FALSE(ace_head_agrees(cfg, topo, 3)); // preset says ACE 2, printer says ACE 1
    }

    SECTION("a stock feeder carries no unit, so a stale one does not break agreement") {
        // ace_head_unit keeps whatever it last held when a head goes back to its feeder; the
        // capacity is what says "feeder", and comparing the unit there would mark a false change.
        const DynamicConfig cfg = preset_with(amHead, {2, 0, 3, 0}, {1, 1, 1, 4});
        for (size_t h = 0; h < 4; ++h)
            REQUIRE(ace_head_agrees(cfg, topo, h));
    }

    SECTION("a preset shorter than the machine disagrees rather than reading past its end") {
        const DynamicConfig cfg = preset_with(amHead, {-1, -1}, {1, 1});
        REQUIRE(ace_head_agrees(cfg, topo, 0));
        REQUIRE_FALSE(ace_head_agrees(cfg, topo, 3));
    }
}

TEST_CASE("units are named as the printer names them", "[AceMmuTopology]")
{
    const AceSnapshot snap = parse_ace_state(std::string(LIVE_HEAD_MODE));
    REQUIRE(snap.units.size() == 1);
    REQUIRE(ace_unit_model(snap.units[0]) == "ACE 2 Pro");

    AceUnit v1;
    v1.protocol = "v1";
    REQUIRE(ace_unit_model(v1) == "ACE Pro");

    AceUnit unknown;
    REQUIRE(ace_unit_model(unknown).empty());
}
