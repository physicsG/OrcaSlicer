#include <catch2/catch.hpp>

#include "libslic3r/Model.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/AceMmuPlan.hpp"
#include "test_data.hpp"

using namespace Slic3r;
using namespace Slic3r::Test;

namespace {
// Self-contained print setup. The shared Test::init_print arrange path is currently
// broken in this fork (its InfiniteBed arrange throws "Objects could not fit on the
// bed" for every caller, see the failing [PrintObject] scenarios), so place the
// object explicitly at the bed centre instead. Volume extruders stay unset (0) so
// the per-role filaments (wall/sparse/solid) drive the tool changes.
void make_print(Print& print, Model& model, std::initializer_list<ConfigBase::SetDeserializeItem> items)
{
    DynamicPrintConfig config = DynamicPrintConfig::full_print_config();
    config.set_deserialize_strict(items);

    ModelObject* object = model.add_object();
    object->name = "cube.stl";
    object->add_volume(Test::mesh(TestMesh::cube_20x20x20));
    ModelInstance* instance = object->add_instance();
    instance->set_offset(Vec3d(100., 100., 0.));
    object->ensure_on_bed();

    print.apply(model, config);
    print.validate();
    print.set_status_silent();
}

std::initializer_list<ConfigBase::SetDeserializeItem> ace_config()
{
    static std::initializer_list<ConfigBase::SetDeserializeItem> items = {
        {"nozzle_diameter",                "0.4,0.4"},
        {"ace_head_capacity",              "1,4"},
        {"single_extruder_multi_material", "0"},
        {"enable_prime_tower",             "0"},
        {"filament_diameter",              "1.75,1.75,1.75"},
        {"filament_colour",                "#FF0000;#00FF00;#0000FF"},
        {"wall_filament",                  "1"},
        {"sparse_infill_filament",         "2"},
        {"solid_infill_filament",          "3"},
        {"machine_start_gcode",            ";ACEPLAN {ace_plan_summary}"},
        {"change_filament_gcode",          ";ACEVARS H{ace_head} S{ace_slot} PH{prev_ace_head} PS{prev_ace_slot} SW{ace_swap}\nT{next_extruder}"},
    };
    return items;
}
} // namespace

// End-to-end wiring: a toolchanger with one ACE-fed head (ace_head_capacity = 1,4)
// printing three filaments (walls / sparse / solid infill) must produce a loading
// plan on Print during processing.
SCENARIO("multiACE loading plan is planned during processing", "[ace_mmu][gcode]")
{
    GIVEN("a 2-head printer, head 2 ACE-fed with 4 slots, and a 3-filament print") {
        Print print;
        Model model;
        make_print(print, model, ace_config());

        WHEN("the print is processed") {
            print.process();

            THEN("Print carries a feasible plan that fits the head capacities") {
                const AceMmu::LoadingPlan& plan = print.ace_plan();
                REQUIRE(plan.feasible);
                REQUIRE(plan.head_of.size() == 3);
                int on_feeder = 0, on_ace = 0;
                for (int c = 0; c < 3; ++c) {
                    REQUIRE(plan.head_of[c] >= 0);
                    REQUIRE(plan.head_of[c] <= 1);
                    (plan.head_of[c] == 0 ? on_feeder : on_ace)++;
                }
                REQUIRE(on_feeder <= 1); // the feeder holds at most its single spool
                REQUIRE(on_ace >= 2);    // so at least two colours share the ACE head
                // Three colours alternating every layer on two heads must swap.
                REQUIRE(plan.swaps > 0);
            }
        }
    }
}

SCENARIO("plain toolchangers get no ACE plan", "[ace_mmu][gcode]")
{
    GIVEN("the same printer with all-feeder heads (default ace_head_capacity)") {
        Print print;
        Model model;
        make_print(print, model, {
            {"nozzle_diameter",                "0.4,0.4"},
            {"single_extruder_multi_material", "0"},
            {"enable_prime_tower",             "0"},
            {"filament_diameter",              "1.75,1.75"},
            {"wall_filament",                  "1"},
            {"sparse_infill_filament",         "2"},
        });

        WHEN("the print is processed") {
            print.process();
            THEN("no plan is computed") {
                REQUIRE_FALSE(print.ace_plan().feasible);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The scenarios below are HIDDEN ([.]) until a pre-existing fff_print harness
// defect is fixed: this fork's Print::export_gcode SIGSEGVs under the bare test
// harness even for a vanilla single-filament print with all ACE changes stashed
// (verified) -- the BBS-derived export path expects plate/GUI context the harness
// does not set up. Run them explicitly with: fff_print_tests "[ace_mmu_export]"
// The export wiring itself is exercised through the real application export.
// ---------------------------------------------------------------------------

SCENARIO("baseline: vanilla single-filament export works in this harness", "[.][ace_mmu_export]")
{
    Print print;
    Model model;
    make_print(print, model, {{"nozzle_diameter", "0.4"}});
    print.process();
    std::string gcode = Test::gcode(print);
    REQUIRE(!gcode.empty());
}

SCENARIO("multiACE plan reaches the exported gcode", "[.][ace_mmu_export]")
{
    GIVEN("the ACE printer and 3-filament print") {
        Print print;
        Model model;
        make_print(print, model, ace_config());

        WHEN("the print is exported") {
            print.process();
            std::string gcode = Test::gcode(print);

            THEN("the gcode carries the plan and per-change ace_* variables") {
                // machine_start_gcode got the plan summary (one T<i>:H<h>S<s> per filament).
                REQUIRE(gcode.find(";ACEPLAN T0:H") != std::string::npos);
                // change_filament_gcode got the variables on every change...
                REQUIRE(gcode.find(";ACEVARS H") != std::string::npos);
                // ...including at least one real ACE swap (two colours share the ACE
                // head and alternate every layer) and at least one free change.
                REQUIRE(gcode.find("SW1") != std::string::npos);
                REQUIRE(gcode.find("SW0") != std::string::npos);
            }
        }
    }
}
