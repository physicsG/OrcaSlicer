#include <catch2/catch.hpp>

#include "libslic3r/AceMmuReconcile.hpp"

#include <fstream>
#include <sstream>

using namespace Slic3r::AceMmu;

// A single 4-slot ACE on unit 0, feeding head 3. Mirrors the machine these tests are
// written against: three stock feeders plus one ACE head.
static const std::vector<int> HEAD_UNIT = {-1, -1, -1, 0};

static AceSlot make_slot(int idx, bool occupied, const std::string &colour,
                         const std::string &material, const std::string &source)
{
    AceSlot s;
    s.idx           = idx;
    s.occupied      = occupied;
    s.state         = occupied ? "ready" : "empty";
    s.raw           = occupied ? 1 : 0;
    s.material      = material;
    s.color_rrggbb  = colour;
    s.source        = source;
    return s;
}

static AceSnapshot one_unit(std::vector<AceSlot> slots)
{
    AceUnit u;
    u.idx       = 0;
    u.connected = true;
    u.slots     = std::move(slots);
    AceSnapshot snap;
    snap.units.push_back(std::move(u));
    return snap;
}

// Four filaments, all on the ACE head, one per slot.
static LoadingPlan ace_plan_4()
{
    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {3, 3, 3, 3};
    p.slot_of  = {0, 1, 2, 3};
    return p;
}

TEST_CASE("a spool matches on colour and material, not on brand", "[ace_mmu]")
{
    CHECK(spool_matches("#e5308c", "PLA", "#e5308c", "PLA"));
    // Case and the alpha byte a project colour may carry are not differences.
    CHECK(spool_matches("#E5308CFF", "pla", "#e5308c", "PLA"));

    // Same colour, different material: a temperature problem, so it must not pass.
    CHECK_FALSE(spool_matches("#e5308c", "PLA", "#e5308c", "PETG"));
    CHECK_FALSE(spool_matches("#e5308c", "PLA", "#83afff", "PLA"));

    // A blank material on either side cannot contradict the other once the colour agrees.
    CHECK(spool_matches("#e5308c", "", "#e5308c", "PLA"));
    CHECK(spool_matches("#e5308c", "PLA", "#e5308c", ""));

    // An unknown colour is not agreement. Silence must never read as a match.
    CHECK_FALSE(spool_matches("", "PLA", "#e5308c", "PLA"));
    CHECK_FALSE(spool_matches("#e5308c", "PLA", "", "PLA"));
}

TEST_CASE("no snapshot means nothing is claimed", "[ace_mmu]")
{
    // The ACE endpoint is LAN-only, so this is the ordinary case over a cloud connection.
    // checked=false is the whole point: a green tick meaning "could not check" would be
    // worse than no check.
    const Reconciliation r = reconcile(AceSnapshot{}, ace_plan_4(), HEAD_UNIT,
                                       {"#e5308c"}, {"PLA"});
    CHECK_FALSE(r.checked);
    CHECK(r.slots.empty());
    CHECK_FALSE(r.any_mismatch());
}

TEST_CASE("an infeasible plan is not reconciled", "[ace_mmu]")
{
    const AceSnapshot snap = one_unit({make_slot(0, true, "#e5308c", "PLA", "rfid")});
    LoadingPlan       p;   // feasible stays false
    CHECK_FALSE(reconcile(snap, p, HEAD_UNIT, {"#e5308c"}, {"PLA"}).checked);
}

TEST_CASE("every slot agreeing reports no mismatch", "[ace_mmu]")
{
    const AceSnapshot snap = one_unit({
        make_slot(0, true, "#e5308c", "PLA", "rfid"),
        make_slot(1, true, "#17b8c4", "PLA", "rfid"),
        make_slot(2, true, "#7a4fb3", "PLA", "override"),   // named by hand, still trusted
        make_slot(3, true, "#d64541", "PLA", "rfid"),
    });
    const Reconciliation r = reconcile(snap, ace_plan_4(), HEAD_UNIT,
                                       {"#e5308c", "#17b8c4", "#7a4fb3", "#d64541"},
                                       {"PLA", "PLA", "PLA", "PLA"});
    REQUIRE(r.checked);
    CHECK(r.slots.size() == 4);
    CHECK(r.count(SlotVerdict::Agrees) == 4);
    CHECK_FALSE(r.any_mismatch());
}

TEST_CASE("the printer's real contents against a four-PLA plan", "[ace_mmu]")
{
    // What this printer last reported: PETG in S1, two empty slots, and a spool in S4 the
    // ACE only inferred. Three definite problems and one it cannot speak to.
    const AceSnapshot snap = one_unit({
        make_slot(0, true,  "#83afff", "PETG", "override"),
        make_slot(1, false, "",        "",     "empty"),
        make_slot(2, false, "",        "",     "empty"),
        make_slot(3, true,  "#8fa7c8", "PETG", "derived"),
    });
    const Reconciliation r = reconcile(snap, ace_plan_4(), HEAD_UNIT,
                                       {"#e5308c", "#17b8c4", "#7a4fb3", "#d64541"},
                                       {"PLA", "PLA", "PLA", "PLA"});
    REQUIRE(r.checked);
    REQUIRE(r.slots.size() == 4);

    CHECK(r.slots[0].verdict == SlotVerdict::Differs);      // PETG where PLA was planned
    CHECK(r.slots[1].verdict == SlotVerdict::Differs);      // empty
    CHECK(r.slots[2].verdict == SlotVerdict::Differs);      // empty
    CHECK(r.slots[3].verdict == SlotVerdict::Unverified);   // occupied, but only inferred

    CHECK(r.count(SlotVerdict::Differs) == 3);
    CHECK(r.count(SlotVerdict::Unverified) == 1);
    CHECK(r.any_mismatch());

    // The UI shows both sides, so both have to survive the comparison.
    CHECK(r.slots[0].expect_colour == "#e5308c");
    CHECK(r.slots[0].actual_colour == "#83afff");
    CHECK(r.slots[0].actual_material == "PETG");
    CHECK(r.slots[1].actual_occupied == false);
}

TEST_CASE("an untrusted spool is never called wrong", "[ace_mmu]")
{
    // Even when the inferred identity happens to contradict the plan outright, the machine
    // is guessing. Calling that a mismatch is how a check earns its way into being ignored.
    const AceSnapshot snap = one_unit({make_slot(0, true, "#000000", "ABS", "derived")});
    LoadingPlan       p;
    p.feasible = true;
    p.head_of  = {3};
    p.slot_of  = {0};
    const Reconciliation r = reconcile(snap, p, HEAD_UNIT, {"#e5308c"}, {"PLA"});
    REQUIRE(r.slots.size() == 1);
    CHECK(r.slots[0].verdict == SlotVerdict::Unverified);
    CHECK_FALSE(r.any_mismatch());
}

TEST_CASE("slots the plan does not use are reported, not judged", "[ace_mmu]")
{
    const AceSnapshot snap = one_unit({
        make_slot(0, true, "#e5308c", "PLA",  "rfid"),
        make_slot(1, true, "#83afff", "PETG", "rfid"),   // loaded, but the plate never uses it
    });
    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {3};
    p.slot_of  = {0};
    const Reconciliation r = reconcile(snap, p, HEAD_UNIT, {"#e5308c"}, {"PLA"});
    REQUIRE(r.slots.size() == 2);
    CHECK(r.slots[0].verdict == SlotVerdict::Agrees);
    CHECK(r.slots[1].verdict == SlotVerdict::Unused);
    CHECK(r.slots[1].filament == -1);
    CHECK_FALSE(r.any_mismatch());   // a spare spool is not a problem
}

TEST_CASE("a filament on a stock feeder is outside the check", "[ace_mmu]")
{
    // The ACE reports its own slots and nothing else, so a wrong colour on T1 is invisible
    // here. The slot numbering overlaps (feeders use slot 0 too), which is exactly why the
    // match is made on the head's ACE unit rather than on the slot number alone.
    const AceSnapshot snap = one_unit({make_slot(0, true, "#e5308c", "PLA", "rfid")});
    LoadingPlan       p;
    p.feasible = true;
    p.head_of  = {0, 3};   // filament 0 on a stock feeder, filament 1 in the ACE
    p.slot_of  = {0, 0};
    const Reconciliation r = reconcile(snap, p, HEAD_UNIT,
                                       {"#111111", "#e5308c"}, {"PLA", "PLA"});
    REQUIRE(r.slots.size() == 1);
    // The ACE slot is judged against filament 1, not the feeder's filament 0.
    CHECK(r.slots[0].filament == 1);
    CHECK(r.slots[0].verdict == SlotVerdict::Agrees);
}
