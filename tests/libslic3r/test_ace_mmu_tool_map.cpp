#include <catch2/catch.hpp>

#include "libslic3r/AceMmuToolMap.hpp"

using namespace Slic3r;
using namespace Slic3r::AceMmu;

// The exact shape Snapmaker's preprint page sends: several lines concatenated into ONE
// string, unquoted values, a trailing SET_PRINT_USED_EXTRUDERS.
static std::string page_batch()
{
    return "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=1\n"
           "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=1\n"
           "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=2 MAP_EXTRUDER=0\n"
           "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=3 MAP_EXTRUDER=0\n"
           "SET_PRINT_USED_EXTRUDERS EXTRUDERS=1,1,0,0\n";
}

TEST_CASE("tool map: the page's own batch is parsed line by line", "[ace_mmu]")
{
    const auto all = parse_tool_map({page_batch()});
    REQUIRE(all.size() == 4);
    CHECK(all[0].logical == 0);
    CHECK(all[0].physical == 1);
    CHECK(all[3].logical == 3);
    CHECK(all[3].physical == 0);

    // Three of the four move a tool off its own head; T1 happens to land back on head 1 and
    // is not a conflict. The guard reports the moves, not the size of the batch.
    const auto moves = non_identity_tool_map({page_batch()});
    REQUIRE(moves.size() == 3);
    CHECK(moves[0].logical == 0);
    CHECK(moves[1].logical == 2);
    CHECK(moves[2].logical == 3);
}

TEST_CASE("tool map: the identity is not a conflict", "[ace_mmu]")
{
    const std::vector<std::string> codes{"SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0 MAP_EXTRUDER=0",
                                         "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=1 MAP_EXTRUDER=1",
                                         "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=2 MAP_EXTRUDER=2",
                                         "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=3 MAP_EXTRUDER=3"};
    CHECK(parse_tool_map(codes).size() == 4);
    CHECK(non_identity_tool_map(codes).empty());
}

TEST_CASE("tool map: unrelated gcode is left alone", "[ace_mmu]")
{
    const std::vector<std::string> codes{"G28", "M104 S200", "SET_PRINT_FILAMENT_CONFIG CONFIG_EXTRUDER=0 FILAMENT_TYPE=PLA",
                                         "SET_PRINT_PREFERENCES TIME_LAPSE_CAMERA=0"};
    CHECK(parse_tool_map(codes).empty());
    CHECK(non_identity_tool_map(codes).empty());
}

TEST_CASE("tool map: quoted values, as third-party macros write them", "[ace_mmu]")
{
    // AFC-Lite's SET_MAP expands to quoted arguments.
    const std::vector<std::string> codes{"SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER='2' MAP_EXTRUDER='3'"};
    const auto                     all = parse_tool_map(codes);
    REQUIRE(all.size() == 1);
    CHECK(all[0].logical == 2);
    CHECK(all[0].physical == 3);
    CHECK(non_identity_tool_map(codes).size() == 1);
}

TEST_CASE("tool map: MAP_EXTRUDER is not mistaken for CONFIG_EXTRUDER", "[ace_mmu]")
{
    // Both keys end in EXTRUDER, and MAP_EXTRUDER comes second in the line. A substring
    // search for "EXTRUDER" would read the same value twice and call every line an
    // identity - which would silently disable the whole guard.
    const std::vector<std::string> codes{"SET_PRINT_EXTRUDER_MAP MAP_EXTRUDER=1 CONFIG_EXTRUDER=0"};
    const auto                     all = parse_tool_map(codes);
    REQUIRE(all.size() == 1);
    CHECK(all[0].logical == 0);
    CHECK(all[0].physical == 1);
    CHECK_FALSE(all[0].identity());
}

TEST_CASE("tool map: malformed lines are ignored, never guessed at", "[ace_mmu]")
{
    const std::vector<std::string> codes{
        "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER= MAP_EXTRUDER=1", // no value
        "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=0",               // half a pair
        "SET_PRINT_EXTRUDER_MAP",                                 // no arguments
        "SET_PRINT_EXTRUDER_MAP CONFIG_EXTRUDER=x MAP_EXTRUDER=1", // not a number
    };
    CHECK(parse_tool_map(codes).empty());
    CHECK(non_identity_tool_map(codes).empty());
}

TEST_CASE("tool map: lowercase and leading whitespace still count", "[ace_mmu]")
{
    const std::vector<std::string> codes{"   set_print_extruder_map config_extruder=1 map_extruder=2"};
    const auto                     all = parse_tool_map(codes);
    REQUIRE(all.size() == 1);
    CHECK(all[0].logical == 1);
    CHECK(all[0].physical == 2);
}

TEST_CASE("tool map: an empty batch is not a conflict", "[ace_mmu]")
{
    CHECK(parse_tool_map({}).empty());
    CHECK(parse_tool_map({""}).empty());
    CHECK(non_identity_tool_map({"", "\n", "\n\n"}).empty());
}
