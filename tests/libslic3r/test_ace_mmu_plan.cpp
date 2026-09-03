#include <catch2/catch.hpp>

#include "libslic3r/AceMmuPlan.hpp"

#include <vector>

using namespace Slic3r::AceMmu;

namespace {
// 3 stock feeders (cap 1) + one 4-slot ACE head — the live "head" mode of the U1.
std::vector<PlanHead> head_mode()
{
    return {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 1, false, -1},
        PlanHead{2, 1, false, -1},
        PlanHead{3, 4, true, 0},
    };
}

// 2 stock feeders + two heads each fed by their own 4-slot ACE unit ("multi" mode).
std::vector<PlanHead> multi_mode()
{
    return {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 1, false, -1},
        PlanHead{2, 4, true, 0},
        PlanHead{3, 4, true, 1},
    };
}

// How many colours share head h in a plan (to sanity-check capacity).
int count_on_head(const LoadingPlan& p, int h)
{
    int n = 0;
    for (int x : p.head_of)
        if (x == h)
            ++n;
    return n;
}
} // namespace

TEST_CASE("<= heads colours land on distinct heads with zero swaps", "[ace_mmu_plan]")
{
    // 4 colours, 4 heads, alternating heavily: every change should be a free tool change.
    std::vector<int> seq = {0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3};
    LoadingPlan p = plan_loading(head_mode(), seq, 4);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 0);
    // all four heads used exactly once
    REQUIRE(count_on_head(p, 0) == 1);
    REQUIRE(count_on_head(p, 1) == 1);
    REQUIRE(count_on_head(p, 2) == 1);
    REQUIRE(count_on_head(p, 3) == 1);
}

TEST_CASE("five colours over four heads cost exactly one swap", "[ace_mmu_plan]")
{
    // 5 distinct colours, 4 heads: by pigeonhole one head must hold two colours, and
    // since both are used the print swaps once on that head. One swap is the minimum
    // and it lands on the ACE head (the only multi-slot head).
    std::vector<int> seq = {0, 1, 2, 3, 4};
    LoadingPlan p = plan_loading(head_mode(), seq, 5);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 1);
    REQUIRE(count_on_head(p, 3) == 2); // the two paired colours share the ACE head
}

TEST_CASE("a swap is counted even when other-head colours sit between the two", "[ace_mmu_plan]")
{
    // Only 1 feeder + 1 ACE(2 slots): 3 colours must be squeezed onto 2 heads.
    // 'A' (feeder colour 0) sits between colour 1 and colour 2 uses. If 1 and 2 share
    // the ACE head, the print still swaps 1<->2 across the intervening 0. The pairwise
    // "direct adjacency" model would miss this — the exact simulator must catch it.
    std::vector<PlanHead> hw = {
        PlanHead{0, 1, false, -1}, // feeder
        PlanHead{1, 2, true, 0},   // ACE, 2 slots
    };
    // sequence: 1, 0, 2, 0, 1, 0, 2  -> colours 1 and 2 never DIRECTLY touch,
    // but on the ACE head the restricted subsequence is 1,2,1,2 => 3 swaps.
    std::vector<int> seq = {1, 0, 2, 0, 1, 0, 2};
    LoadingPlan p = plan_loading(hw, seq, 3);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    // Best is to put the busiest colour (0) alone on the feeder and 1,2 on the ACE.
    // Restricted ACE subsequence 1,2,1,2 -> 3 swaps. No assignment does better here.
    REQUIRE(p.swaps == 3);
}

TEST_CASE("rarely-used colours are parked together on the ACE head", "[ace_mmu_plan]")
{
    // The user's scenario: 7 colours, 3 of them printed only rarely. The heavily-used,
    // constantly-alternating colours (0,1,2) should each get their own free feeder head;
    // the fourth busy colour (3) resides on the ACE head, and the 3 rare colours (4,5,6)
    // join it there — each only triggers a couple of swaps.
    std::vector<int> seq;
    // 8 rounds of heavy alternation among 0,1,2,3 ...
    for (int r = 0; r < 8; ++r) {
        seq.push_back(0);
        seq.push_back(1);
        seq.push_back(2);
        seq.push_back(3);
    }
    // ... with the rare colours dropped in occasionally.
    seq.push_back(4);
    seq.push_back(0);
    seq.push_back(5);
    seq.push_back(1);
    seq.push_back(6);
    seq.push_back(2);

    LoadingPlan p = plan_loading(head_mode(), seq, 7);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    // All three rare colours land on the ACE head (the only multi-slot head).
    REQUIRE(p.head_of[4] == 3);
    REQUIRE(p.head_of[5] == 3);
    REQUIRE(p.head_of[6] == 3);
    REQUIRE(count_on_head(p, 3) == 4); // busy colour 3 + the three rare ones

    // The three busiest colours each get their own feeder head (free tool changes).
    REQUIRE(p.head_of[0] != p.head_of[1]);
    REQUIRE(p.head_of[1] != p.head_of[2]);
    REQUIRE(p.head_of[0] != p.head_of[2]);
    REQUIRE(p.head_of[0] != 3);
    REQUIRE(p.head_of[1] != 3);
    REQUIRE(p.head_of[2] != 3);

    // Exact optimum, hand-checked: the ACE head must hold exactly 4 of the 7 colours;
    // any set containing two of the alternating colours explodes, and of the sets
    // {busy, 4, 5, 6} only busy = 3 keeps the tail cheap. Its restricted subsequence
    // is 3,3,...,3,4,5,6 -> 4 runs -> 3 swaps.
    REQUIRE(p.swaps == 3);
}

TEST_CASE("generalises to several ACE units (multi mode)", "[ace_mmu_plan]")
{
    // 6 colours, each printed once in disjoint phases. With 4 heads used, the first
    // colour each head presents is a free load; the two "extra" colours (6 - 4) each
    // cost exactly one swap wherever they land. So the minimum is provably 2 swaps,
    // independent of which heads the solver picks — a clean check that multiple ACE
    // heads are handled by the same solver.
    std::vector<int> seq = {0, 1, 2, 3, 4, 5};
    LoadingPlan p = plan_loading(multi_mode(), seq, 6);
    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 2);
    for (int c = 0; c < 6; ++c)
        REQUIRE(p.head_of[c] >= 0); // every colour assigned
}

TEST_CASE("combining ACE units into one head is just a larger capacity", "[ace_mmu_plan]")
{
    // As the H2D combines multiple AMS per nozzle, two ACE units combined onto one
    // head is modelled as a single head with the summed slot count (here 8).
    std::vector<PlanHead> combined = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 8, true, -1}, // two 4-slot ACE units combined -> capacity 8
    };
    std::vector<int> seq = {0, 1, 2, 3, 4, 5, 6, 7, 8};
    LoadingPlan p = plan_loading(combined, seq, 9); // 1 + 8 = 9 slots, exactly fits
    REQUIRE(p.feasible);
    REQUIRE(count_on_head(p, 1) == 8);
    // Invariant across ALL feasible assignments here: each colour is used once, so
    // each head's swaps = (colours on it) - 1, giving 0 + 7 regardless of the split.
    REQUIRE(p.swaps == 7);
    REQUIRE(p.optimal);
}

TEST_CASE("scales to 4 ACE units / 16 colours within the work budget", "[ace_mmu_plan]")
{
    // The full build-out someone could actually run: 4 ACE units, one per head, so
    // every head carries 4 slots and the palette is 16 colours. Exhaustive
    // enumeration is hopeless here; the branch-and-bound must return a valid plan
    // (never worse than a naive one) inside its work budget.
    std::vector<PlanHead> maxed = {
        PlanHead{0, 4, true, 0},
        PlanHead{1, 4, true, 1},
        PlanHead{2, 4, true, 2},
        PlanHead{3, 4, true, 3},
    };
    // Deterministic pseudo-random colour sequence (fixed LCG, no libc rand).
    std::vector<int> seq;
    std::uint32_t x = 12345u;
    for (int i = 0; i < 240; ++i) {
        x = x * 1103515245u + 12345u;
        seq.push_back(static_cast<int>((x >> 16) % 16u));
    }

    LoadingPlan p = plan_loading(maxed, seq, 16);
    REQUIRE(p.feasible);
    // Valid: every colour assigned, no head over its 4 slots.
    for (int c = 0; c < 16; ++c)
        REQUIRE(p.head_of[c] >= 0);
    for (int h = 0; h < 4; ++h)
        REQUIRE(count_on_head(p, h) <= 4);

    // Never worse than a naive block assignment (colour i -> head i/4).
    // Margin is instance-verified, not a theorem: on this exact LCG sequence the
    // naive plan costs 183 swaps, the greedy seed lands in [167, 175] under every
    // legal ordering of equal-occurrence colours, and the true optimum is 163 —
    // so the bound holds on every conforming platform. If you regenerate the
    // sequence or seed, re-verify the margin before trusting this assertion.
    std::vector<int> naive(16);
    for (int c = 0; c < 16; ++c)
        naive[c] = c / 4;
    const std::vector<int> collapsed = collapse_runs(seq, 16);
    REQUIRE(p.swaps <= simulate_swaps(collapsed, naive, 4));
}

TEST_CASE("more used colours than slots is infeasible, with the -1 contract intact", "[ace_mmu_plan]")
{
    std::vector<PlanHead> two_feeders = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 1, false, -1},
    };
    LoadingPlan p = plan_loading(two_feeders, std::vector<int>{0, 1, 2}, 3);
    REQUIRE_FALSE(p.feasible);
    // Even infeasible plans keep head_of/slot_of at size n, filled with -1, so
    // callers can index them safely.
    REQUIRE(p.head_of.size() == 3);
    REQUIRE(p.slot_of.size() == 3);
    for (int c = 0; c < 3; ++c) {
        REQUIRE(p.head_of[c] == -1);
        REQUIRE(p.slot_of[c] == -1);
    }
}

TEST_CASE("extra defined-but-unused colours never make a printable plate infeasible", "[ace_mmu_plan]")
{
    // 3 physical slots, 4 defined filaments, only 2 ever printed: the plate is
    // printable. Spare colours park in leftover slots; the overflow one simply
    // stays unloaded (head -1) instead of poisoning feasibility.
    std::vector<PlanHead> hw = {
        PlanHead{0, 1, false, -1}, // feeder
        PlanHead{1, 2, true, 0},   // ACE, 2 slots
    };
    std::vector<int> seq = {0, 1, 0, 1};
    LoadingPlan p = plan_loading(hw, seq, 4);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 0); // the two used colours alternate -> distinct heads
    REQUIRE(p.head_of[0] >= 0);
    REQUIRE(p.head_of[1] >= 0);
    REQUIRE(p.head_of[0] != p.head_of[1]);
    int assigned = 0;
    for (int c = 0; c < 4; ++c)
        if (p.head_of[c] >= 0)
            ++assigned;
    REQUIRE(assigned == 3); // 3 slots -> exactly one unused colour stays unloaded
}

TEST_CASE("slots are assigned in first-use order within a head", "[ace_mmu_plan]")
{
    // 3 colours on a single 4-slot ACE head; first-used colour gets slot 0.
    std::vector<PlanHead> one_ace = {PlanHead{0, 4, true, 0}};
    std::vector<int> seq = {2, 0, 1, 2, 0};
    LoadingPlan p = plan_loading(one_ace, seq, 3);

    REQUIRE(p.feasible);
    REQUIRE(p.slot_of[2] == 0); // colour 2 used first
    REQUIRE(p.slot_of[0] == 1);
    REQUIRE(p.slot_of[1] == 2);
}

TEST_CASE("unused colours do not inflate the swap count", "[ace_mmu_plan]")
{
    // A project can define more filaments than a given plate uses. Unused colours
    // must park anywhere without charging swaps, and still get a deterministic slot.
    std::vector<int> seq = {0, 1, 0, 1}; // colours 2..4 defined but never printed
    LoadingPlan p = plan_loading(head_mode(), seq, 5);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 0);
    for (int c = 0; c < 5; ++c) {
        REQUIRE(p.head_of[c] >= 0); // capacity 7 -> everything gets parked
        REQUIRE(p.slot_of[c] >= 0);
    }
}

TEST_CASE("pinned colours stay at their pin even when it costs swaps", "[ace_mmu_plan]")
{
    // Two heavily alternating colours: free (unpinned) optimum is 0 swaps on
    // distinct heads. Pin BOTH onto the ACE head — e.g. both spools must keep
    // drying — and the plan must obey, honestly reporting the price: restricted
    // subsequence 0,1,0,1,0,1 -> 6 runs -> 5 swaps.
    std::vector<int> seq = {0, 1, 0, 1, 0, 1};

    LoadingPlan free_plan = plan_loading(head_mode(), seq, 2);
    REQUIRE(free_plan.feasible);
    REQUIRE(free_plan.swaps == 0);

    std::vector<PlanPin> pins(2);
    pins[0].head = 3;
    pins[1].head = 3;
    LoadingPlan p = plan_loading(head_mode(), seq, 2, pins);
    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.head_of[0] == 3);
    REQUIRE(p.head_of[1] == 3);
    REQUIRE(p.swaps == 5);
}

TEST_CASE("a drying spool can be pinned to its ACE unit", "[ace_mmu_plan]")
{
    // multi mode: pin colour 5 into ACE unit 1 (the one drying it). Unit 1 feeds
    // head 3, so the colour must land there; the disjoint-phase sequence still
    // costs the pigeonhole minimum of 2 swaps.
    std::vector<int> seq = {0, 1, 2, 3, 4, 5};
    std::vector<PlanPin> pins(6);
    pins[5].ace_unit = 1;
    LoadingPlan p = plan_loading(multi_mode(), seq, 6, pins);

    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.head_of[5] == 3);
    REQUIRE(p.swaps == 2);
}

TEST_CASE("a slot pin reserves the exact slot", "[ace_mmu_plan]")
{
    // Colour 0 physically sits (and dries) in slot 3; the others take the remaining
    // slots in first-use order around it.
    std::vector<PlanHead> one_ace = {PlanHead{0, 4, true, 0}};
    std::vector<int> seq = {2, 0, 1, 2, 0};
    std::vector<PlanPin> pins(3);
    pins[0].head = 0;
    pins[0].slot = 3;
    LoadingPlan p = plan_loading(one_ace, seq, 3, pins);

    REQUIRE(p.feasible);
    REQUIRE(p.slot_of[0] == 3);
    REQUIRE(p.slot_of[2] == 0); // first used, lowest free slot
    REQUIRE(p.slot_of[1] == 1);
}

TEST_CASE("a pinned but unused colour still occupies its slot", "[ace_mmu_plan]")
{
    // The physical drying case: the spool sits in the ACE whether or not this plate
    // prints it, so it must count against capacity at its pin.
    std::vector<PlanHead> hw = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 2, true, 0},
    };
    std::vector<int> seq = {0, 1, 0, 1};
    std::vector<PlanPin> pins(3);
    pins[2].head = 1; // colour 2 never printed, but its spool sits in the ACE
    pins[2].slot = 1;
    LoadingPlan p = plan_loading(hw, seq, 3, pins);

    REQUIRE(p.feasible);
    REQUIRE(p.swaps == 0);
    REQUIRE(p.head_of[2] == 1);
    REQUIRE(p.slot_of[2] == 1);
    REQUIRE(p.head_of[0] != p.head_of[1]); // used colours still split across heads
}

TEST_CASE("conflicting pins are infeasible", "[ace_mmu_plan]")
{
    // Two colours pinned onto the same 1-spool feeder cannot both fit.
    std::vector<int> seq = {0, 1};
    std::vector<PlanPin> pins(2);
    pins[0].head = 0;
    pins[1].head = 0;
    LoadingPlan p = plan_loading(head_mode(), seq, 2, pins);
    REQUIRE_FALSE(p.feasible);
    REQUIRE(p.head_of.size() == 2);
    REQUIRE(p.head_of[0] == -1);
    REQUIRE(p.head_of[1] == -1);
}

TEST_CASE("an exhausted work budget returns the greedy plan with optimal=false", "[ace_mmu_plan]")
{
    // budget = 1: the root node passes the budget check, but the first candidate
    // scan drives it negative, so the search stops after seeding. The documented
    // contract: feasible, optimal == false, and never worse than the greedy seed
    // (which equals the optimum, 3, on this instance).
    std::vector<PlanHead> hw = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 2, true, 0},
    };
    std::vector<int> seq = {1, 0, 2, 0, 1, 0, 2};
    LoadingPlan p = plan_loading(hw, seq, 3, {}, 1);
    REQUIRE(p.feasible);
    REQUIRE_FALSE(p.optimal);
    REQUIRE(p.swaps == 3);
}

TEST_CASE("manual mode: evaluate_assignment prices a user layout without moving it", "[ace_mmu_plan]")
{
    std::vector<PlanHead> hw = {
        PlanHead{0, 1, false, -1},
        PlanHead{1, 2, true, 0},
    };
    std::vector<int> seq = {0, 1, 0, 1, 0, 1};

    // The user parks both alternating colours on the ACE: legal, expensive, honest.
    LoadingPlan manual = evaluate_assignment(hw, seq, 2, {1, 1});
    REQUIRE(manual.feasible);
    REQUIRE_FALSE(manual.optimal); // a user layout is never a proven optimum
    REQUIRE(manual.swaps == 5);
    REQUIRE(manual.head_of[0] == 1);
    REQUIRE(manual.head_of[1] == 1);

    // Auto on the same input for the "yours vs auto" comparison.
    LoadingPlan aut = plan_loading(hw, seq, 2);
    REQUIRE(aut.swaps == 0);

    // Over capacity is rejected.
    REQUIRE_FALSE(evaluate_assignment(hw, seq, 2, {0, 0}).feasible);
    // An unused colour may be left unloaded (-1)...
    REQUIRE(evaluate_assignment(hw, seq, 3, {0, 1, -1}).feasible);
    // ...but a printed colour may not.
    REQUIRE_FALSE(evaluate_assignment(hw, seq, 2, {0, -1}).feasible);
}

TEST_CASE("transition_weights builds the symmetric conflict matrix", "[ace_mmu_plan]")
{
    // seq 1,0,2,0,1,0,2: direct switches 1-0, 0-2, 2-0, 0-1, 1-0, 0-2.
    std::vector<int> seq = {1, 0, 2, 0, 1, 0, 2};
    auto w = transition_weights(seq, 3);
    REQUIRE(w[0][1] == 3);
    REQUIRE(w[1][0] == 3);
    REQUIRE(w[0][2] == 3);
    REQUIRE(w[2][0] == 3);
    REQUIRE(w[1][2] == 0); // never directly adjacent
    REQUIRE(w[0][0] == 0);
}

TEST_CASE("empty sequence is trivially feasible", "[ace_mmu_plan]")
{
    LoadingPlan p = plan_loading(head_mode(), std::vector<int>{}, 0);
    REQUIRE(p.feasible);
    REQUIRE(p.optimal);
    REQUIRE(p.swaps == 0);
}
