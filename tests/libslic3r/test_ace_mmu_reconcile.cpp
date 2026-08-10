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
    CHECK(r.unresolved() == 0);   // the only state that lets a print through unattended
}

TEST_CASE("the printer's real contents against a four-PLA plan", "[ace_mmu]")
{
    // Read from the machine at 192.168.2.242 while writing this: one PETG spool the user
    // named by hand in S1, and three empty slots. Every slot the plan wants is wrong, and
    // none of it is guesswork - the ACE is certain about all four.
    const AceSnapshot snap = one_unit({
        make_slot(0, true,  "#83afff", "PETG", "override"),
        make_slot(1, false, "",        "",     "empty"),
        make_slot(2, false, "",        "",     "empty"),
        make_slot(3, false, "",        "",     "empty"),
    });
    const Reconciliation r = reconcile(snap, ace_plan_4(), HEAD_UNIT,
                                       {"#e5308c", "#17b8c4", "#7a4fb3", "#d64541"},
                                       {"PLA", "PLA", "PLA", "PLA"});
    REQUIRE(r.checked);
    REQUIRE(r.slots.size() == 4);

    CHECK(r.slots[0].verdict == SlotVerdict::Differs);   // PETG where PLA was planned
    CHECK(r.slots[1].verdict == SlotVerdict::Differs);   // empty
    CHECK(r.slots[2].verdict == SlotVerdict::Differs);   // empty
    CHECK(r.slots[3].verdict == SlotVerdict::Differs);   // empty

    CHECK(r.count(SlotVerdict::Differs) == 4);
    CHECK(r.any_mismatch());
    CHECK(r.unresolved() == 4);

    // The UI shows both sides, so both have to survive the comparison.
    CHECK(r.slots[0].expect_colour == "#e5308c");
    CHECK(r.slots[0].actual_colour == "#83afff");
    CHECK(r.slots[0].actual_material == "PETG");
    CHECK(r.slots[1].actual_occupied == false);
}

TEST_CASE("an untrusted spool is unresolved, not called wrong", "[ace_mmu]")
{
    // Even when the inferred identity contradicts the plan outright, the machine is guessing,
    // so the label stays "cannot tell" - the remedy is to name the spool, not to swap it.
    // It still holds the gate shut: not knowing is not evidence that the plate is safe.
    const AceSnapshot snap = one_unit({make_slot(0, true, "#000000", "ABS", "derived")});
    LoadingPlan       p;
    p.feasible = true;
    p.head_of  = {3};
    p.slot_of  = {0};
    const Reconciliation r = reconcile(snap, p, HEAD_UNIT, {"#e5308c"}, {"PLA"});
    REQUIRE(r.slots.size() == 1);
    CHECK(r.slots[0].verdict == SlotVerdict::Unverified);
    CHECK_FALSE(r.any_mismatch());   // wording: nothing is provably wrong
    CHECK(r.unresolved() == 1);      // gate: nothing is provably right either
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
    CHECK(r.unresolved() == 0);      // and does not hold the gate shut
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

// ---------------------------------------------------------------------------------------
// Two ACE units. The planner and the config have always allowed up to four, but every
// test and every real slice so far has run against a single unit - so the code that maps
// a slot back to the head feeding it has never actually had to discriminate. Slot numbers
// are per head, so unit 0 slot 0 and unit 1 slot 0 are different physical places that
// would look identical to anything matching on the slot number alone.
// ---------------------------------------------------------------------------------------

// Two stock feeders, then two 4-slot ACEs: head 2 fed by unit 0, head 3 by unit 1.
static const std::vector<int> HEAD_UNIT_2 = {-1, -1, 0, 1};

static AceSnapshot two_units(std::vector<AceSlot> unit0, std::vector<AceSlot> unit1)
{
    AceUnit a;
    a.idx = 0; a.connected = true; a.slots = std::move(unit0);
    AceUnit b;
    b.idx = 1; b.connected = true; b.slots = std::move(unit1);
    AceSnapshot snap;
    snap.units.push_back(std::move(a));
    snap.units.push_back(std::move(b));
    return snap;
}

TEST_CASE("two ACE units: each slot is judged against its own unit", "[ace_mmu]")
{
    // Both units hold a spool in slot 0, and they are different colours. The plan puts
    // filament 0 in unit 0 slot 0 and filament 1 in unit 1 slot 0 - each correct for its
    // own unit. Matching on the slot number alone would cross them over and call both wrong.
    const AceSnapshot snap = two_units(
        {make_slot(0, true, "#e5308c", "PLA", "rfid")},
        {make_slot(0, true, "#17b8c4", "PLA", "rfid")});

    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {2, 3};   // filament 0 -> head 2 (unit 0), filament 1 -> head 3 (unit 1)
    p.slot_of  = {0, 0};   // both in slot 0 of their own unit

    const Reconciliation r = reconcile(snap, p, HEAD_UNIT_2,
                                       {"#e5308c", "#17b8c4"}, {"PLA", "PLA"});
    REQUIRE(r.checked);
    REQUIRE(r.slots.size() == 2);

    CHECK(r.slots[0].unit == 0);
    CHECK(r.slots[0].filament == 0);
    CHECK(r.slots[0].verdict == SlotVerdict::Agrees);

    CHECK(r.slots[1].unit == 1);
    CHECK(r.slots[1].filament == 1);
    CHECK(r.slots[1].verdict == SlotVerdict::Agrees);

    CHECK(r.unresolved() == 0);
}

TEST_CASE("two ACE units: a mismatch is attributed to the right unit", "[ace_mmu]")
{
    // Swap what the two units are holding. Every slot is now wrong, and the report has to
    // say so per unit rather than blaming one twice or cancelling out.
    const AceSnapshot snap = two_units(
        {make_slot(0, true, "#17b8c4", "PLA", "rfid")},   // unit 0 holds unit 1's spool
        {make_slot(0, true, "#e5308c", "PLA", "rfid")});  // and vice versa

    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {2, 3};
    p.slot_of  = {0, 0};

    const Reconciliation r = reconcile(snap, p, HEAD_UNIT_2,
                                       {"#e5308c", "#17b8c4"}, {"PLA", "PLA"});
    REQUIRE(r.slots.size() == 2);
    CHECK(r.slots[0].verdict == SlotVerdict::Differs);
    CHECK(r.slots[1].verdict == SlotVerdict::Differs);
    CHECK(r.count(SlotVerdict::Differs) == 2);

    // Both sides are reported per slot, so the message can name what to move where.
    CHECK(r.slots[0].expect_colour == "#e5308c");
    CHECK(r.slots[0].actual_colour == "#17b8c4");
    CHECK(r.slots[1].expect_colour == "#17b8c4");
    CHECK(r.slots[1].actual_colour == "#e5308c");
}

TEST_CASE("two ACE units: a head's slot is not confused with the other unit's", "[ace_mmu]")
{
    // Only unit 1 is used by the plate. Unit 0's slot 0 holds something unrelated, and must
    // come back Unused - not judged against the filament that lives in unit 1's slot 0.
    const AceSnapshot snap = two_units(
        {make_slot(0, true, "#83afff", "PETG", "rfid")},  // a spare, nothing plans for it
        {make_slot(0, true, "#e5308c", "PLA",  "rfid")});

    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {3};
    p.slot_of  = {0};

    const Reconciliation r = reconcile(snap, p, HEAD_UNIT_2, {"#e5308c"}, {"PLA"});
    REQUIRE(r.slots.size() == 2);
    CHECK(r.slots[0].unit == 0);
    CHECK(r.slots[0].verdict == SlotVerdict::Unused);
    CHECK(r.slots[0].filament == -1);
    CHECK(r.slots[1].unit == 1);
    CHECK(r.slots[1].verdict == SlotVerdict::Agrees);
    CHECK(r.unresolved() == 0);   // a spare spool in the other unit is not a problem
}

TEST_CASE("two ACE units: capacity is the sum, and the planner uses both", "[ace_mmu]")
{
    // 1 + 1 + 4 + 4 = 10 places. Ten colours fit; eleven do not.
    std::vector<PlanHead> heads = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 1, false, -1},
        PlanHead{2, 4, true, 0},
        PlanHead{3, 4, true, 1},
    };
    std::vector<int> seq;
    for (int round = 0; round < 3; ++round)
        for (int c = 0; c < 10; ++c)
            seq.push_back(c);

    const LoadingPlan ten = plan_loading(heads, seq, 10);
    REQUIRE(ten.feasible);
    // Every colour placed, and both ACE units carrying their share - four each, since the
    // two feeders take one apiece.
    int on_unit0 = 0, on_unit1 = 0;
    for (int c = 0; c < 10; ++c) {
        REQUIRE(ten.head_of[c] >= 0);
        if (ten.head_of[c] == 2) ++on_unit0;
        if (ten.head_of[c] == 3) ++on_unit1;
    }
    CHECK(on_unit0 == 4);
    CHECK(on_unit1 == 4);

    seq.push_back(10);
    CHECK_FALSE(plan_loading(heads, seq, 11).feasible);
}

TEST_CASE("a plan addressing an ACE the machine does not report", "[ace_mmu]")
{
    // Printer settings say head 3 is fed by ACE 2, but only one unit answered. Iterating
    // the snapshot alone would skip that spool entirely and pass the plate on the strength
    // of the unit that did answer. There is nowhere to load it from, so it is a mismatch.
    const AceSnapshot snap = one_unit({make_slot(0, true, "#e5308c", "PLA", "rfid")});

    LoadingPlan p;
    p.feasible = true;
    p.head_of  = {2, 3};   // head 2 -> unit 0 (present), head 3 -> unit 1 (absent)
    p.slot_of  = {0, 0};

    const Reconciliation r = reconcile(snap, p, HEAD_UNIT_2,
                                       {"#e5308c", "#17b8c4"}, {"PLA", "PLA"});
    REQUIRE(r.checked);
    REQUIRE(r.slots.size() == 2);

    // Unit 0's slot agrees...
    CHECK(r.slots[0].unit == 0);
    CHECK(r.slots[0].verdict == SlotVerdict::Agrees);
    CHECK_FALSE(r.slots[0].unit_missing);

    // ...and the spool bound for the absent unit is reported, not silently dropped.
    CHECK(r.slots[1].unit == 1);
    CHECK(r.slots[1].filament == 1);
    CHECK(r.slots[1].verdict == SlotVerdict::Differs);
    CHECK(r.slots[1].unit_missing);
    CHECK(r.slots[1].expect_colour == "#17b8c4");

    CHECK(r.unresolved() == 1);   // and it holds the gate shut
}

TEST_CASE("a stock feeder is not mistaken for a missing ACE", "[ace_mmu]")
{
    // head_unit is -1 for feeders. The missing-unit sweep must skip them, or every
    // feeder-borne filament would be reported as bound for an absent ACE.
    const AceSnapshot snap = one_unit({make_slot(0, true, "#e5308c", "PLA", "rfid")});
    LoadingPlan       p;
    p.feasible = true;
    p.head_of  = {0, 1, 2};   // two feeders and one real ACE head
    p.slot_of  = {0, 0, 0};
    const Reconciliation r = reconcile(snap, p, HEAD_UNIT_2,
                                       {"#111111", "#222222", "#e5308c"},
                                       {"PLA", "PLA", "PLA"});
    REQUIRE(r.slots.size() == 1);        // only the ACE slot is judged
    CHECK(r.slots[0].verdict == SlotVerdict::Agrees);
    CHECK(r.unresolved() == 0);
}
