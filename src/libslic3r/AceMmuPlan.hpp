#ifndef slic3r_AceMmuPlan_hpp_
#define slic3r_AceMmuPlan_hpp_

// Optimal spool-loading plan for the Snapmaker U1 + multiACE.
//
// The U1 is a hybrid toolchanger + MMU: N physical heads, each either a stock
// *feeder* (1 spool, changes between heads are FREE tool changes) or an *ACE* head
// (holds up to `capacity` spools; a change between two colours on the SAME ACE head
// is a slow ACE swap that retracts+reloads+purges). Given the print's colour-change
// sequence, assign each colour to a (head, slot) so the number of ACE swaps is
// minimised.
//
// Key property (the whole point): rarely-used colours are cheap to park together on
// an ACE head, because switching to a colour that is only printed a few times costs
// only a few swaps. Heavily-used colours that alternate constantly want their own
// feeder heads, where changes are free tool changes. The optimiser discovers this
// automatically by minimising the true swap count.
//
// Swap cost is measured EXACTLY: the number of swaps a head performs equals the
// number of runs in the full colour sequence restricted to that head's colours,
// minus one (the initial load is free). A swap happens even when the two colours are
// separated in the sequence by colours printed on *other* heads — so the cost cannot
// be reduced to a pairwise "adjacency" matrix; it is computed on the real sequence.
//
// The machine is a plain list of heads, each {capacity, ace}. This one abstraction
// covers every multiACE configuration with no special-casing: several ACE units
// feeding several heads are just several `ace` heads; combining multiple ACE units
// onto one head (as the Bambu H2D combines AMS per nozzle) is that head's capacity =
// the sum of the combined units' slots. With 4 ACE units on 4 heads the palette is
// 16 colours — and more is possible with extra combiners — so the solver is a
// branch-and-bound, not a plain enumeration:
//   - a greedy busiest-first seed provides an immediate upper bound;
//   - partial assignments are themselves admissible lower bounds (adding a colour to
//     a head can only add runs, never remove them), tightened by a pigeonhole term
//     (each used colour beyond the free head-first-loads costs >= 1 swap);
//   - children are explored cheapest-delta-first, with symmetry breaking across
//     interchangeable empty equal-capacity heads;
//   - a work budget caps runtime; if it runs out the best plan found so far is
//     returned with `optimal = false` (never worse than the greedy seed).
// Typical U1 jobs (<= ~10 colours) are solved to proven optimality within the
// default budget; 16-colour full build-outs return an optimal-or-near-optimal plan
// well under a second, flagged `optimal = false` if the search was cut short.
//
// PINS (hard constraints): each colour can be pinned to a head, an ACE unit, or an
// exact slot — see PlanPin. Pinned colours never move; the search optimises the free
// colours around them. Pinning everything is "manual mode" (see also
// evaluate_assignment, which prices a user-made layout without optimising it).
//
// This is the U1's clean-room equivalent of Bambu's H2D `fmmAutoForFlush` filament
// grouping (whose algorithm is not open); the result is meant to become a
// `filament_map`.
//
// Pure/header-only (no GUI, no printer, no libslic3r deps) so it is easy to unit-test.
// See docs/ace-mmu/10-slicing-plan.md.

#include <algorithm>
#include <cstdint>
#include <functional>
#include <limits>
#include <numeric>
#include <vector>

namespace Slic3r { namespace AceMmu {

// One physical toolhead's capacity for the plan.
struct PlanHead
{
    int  idx      = 0;     // head index (0..3)
    int  capacity = 1;     // 1 = stock feeder; >1 = ACE slots (sum when units are combined)
    bool ace      = false; // true = ACE-fed (swaps cost time+purge); false = feeder
    int  ace_unit = -1;    // which ACE unit feeds it (if ace; -1 for combined/none)
};

struct LoadingPlan
{
    bool             feasible = false;
    bool             optimal  = false; // search completed: the swap count is proven minimal
    int              swaps    = 0;     // predicted ACE swaps (best found)
    std::vector<int> head_of;          // colour -> index into the heads vector (-1 = not loaded)
    std::vector<int> slot_of;          // colour -> slot within that head (-1 = not loaded)
};

// Optional per-colour placement constraint ("pin"). Pins are HARD: the optimiser
// plans around them, never moves them. The flagship use case is drying — a
// hygroscopic spool sitting in an ACE that is actively drying it must stay in that
// ACE (even in its exact slot) for the whole print, no matter what the swap count
// would prefer. A pinned colour occupies its slot even if the plate never prints it.
//   head >= 0      : colour must live on that head (feeder or ACE).
//   ace_unit >= 0  : colour must live on a head fed by that ACE unit (used when the
//                    head is not directly known; ignored if `head` is set).
//   slot >= 0      : exact slot within the pinned position. Honoured when the pin
//                    resolves to a single head (the physical case); a slot pin on an
//                    ambiguous multi-head unit constrains only the unit.
struct PlanPin
{
    int head     = -1;
    int ace_unit = -1;
    int slot     = -1;
};

// Collapse consecutive duplicates: the sequence of *changes* is all that matters.
inline std::vector<int> collapse_runs(const std::vector<int>& seq, int n)
{
    std::vector<int> c;
    c.reserve(seq.size());
    int prev = -1;
    for (int x : seq) {
        if (x < 0 || x >= n)
            continue;
        if (x != prev) {
            c.push_back(x);
            prev = x;
        }
    }
    return c;
}

// Exact ACE-swap count for a full colour->head assignment, by walking the sequence
// and swapping a head's loaded spool whenever it must present a different colour.
// The first colour a head presents is a free initial load, not a swap. Colours with
// head -1 are skipped, which is what makes partial assignments valid lower bounds.
inline int simulate_swaps(const std::vector<int>& collapsed, const std::vector<int>& head_of, int num_heads)
{
    std::vector<int> loaded(num_heads, -1); // colour currently on each head
    int swaps = 0;
    for (int c : collapsed) {
        if (c < 0 || c >= static_cast<int>(head_of.size()))
            continue;
        const int h = head_of[c];
        if (h < 0 || h >= num_heads)
            continue;
        if (loaded[h] != c) {
            if (loaded[h] != -1)
                ++swaps;      // head already held a different colour -> real swap
            loaded[h] = c;
        }
    }
    return swaps;
}

// Symmetric transition-weight matrix: w[a][b] = how many times the print switches
// directly between colours a and b. NOT the objective (see simulate_swaps) — kept as
// a diagnostic for UIs that want to display a colour-conflict heatmap.
inline std::vector<std::vector<int>> transition_weights(const std::vector<int>& seq, int n)
{
    std::vector<std::vector<int>> w(n, std::vector<int>(n, 0));
    int prev = -1;
    for (int c : seq) {
        if (c < 0 || c >= n)
            continue;
        if (prev >= 0 && prev != c) {
            w[prev][c]++;
            w[c][prev]++;
        }
        prev = c;
    }
    return w;
}

namespace detail {

// Runs of head h's restricted subsequence, optionally pretending colour `extra` is
// also on h. swaps(h) = max(0, runs - 1).
inline int runs_on_head(const std::vector<int>& collapsed, const std::vector<int>& assign, int h, int extra = -1)
{
    int runs = 0, prev = -1;
    for (int c : collapsed) {
        if (c != extra && assign[c] != h)
            continue;
        if (c != prev) {
            ++runs;
            prev = c;
        }
    }
    return runs;
}

} // namespace detail

// Core solver: branch-and-bound over colour->head assignments, evaluating the true
// swap count on the real sequence.
//
// Only colours that are USED in the sequence, or PINNED (a pinned spool physically
// occupies its slot), compete for capacity. Extra defined-but-unused colours never
// make a printable plate infeasible: they are parked in leftover slots when room
// remains and otherwise stay unloaded (head_of/slot_of = -1). On an infeasible
// result head_of/slot_of are still size n, filled with -1.
//
// `pins` (empty, or one PlanPin per colour) are HARD placement constraints; an
// all-pinned call is "manual mode" (the solver just validates and prices the user's
// layout). The result is deterministic: all orderings carry explicit tie-breaks.
inline LoadingPlan plan_loading(const std::vector<PlanHead>& heads,
                                const std::vector<int>&      sequence,
                                int                          n,
                                const std::vector<PlanPin>&  pins        = {},
                                std::int64_t                 work_budget = 64ll * 1000 * 1000)
{
    LoadingPlan best;
    if (n <= 0) {
        best.feasible = true;
        best.optimal  = true;
        return best;
    }
    best.head_of.assign(n, -1); // the -1 contract holds on every return path
    best.slot_of.assign(n, -1);

    const int H = static_cast<int>(heads.size());
    if (H == 0)
        return best;
    std::vector<int> cap(H);
    int              total_cap = 0;
    for (int h = 0; h < H; ++h) {
        cap[h] = std::max(1, heads[h].capacity);
        total_cap += cap[h];
    }

    const std::vector<int> collapsed = collapse_runs(sequence, n);
    const std::int64_t     scan_cost = std::max<std::int64_t>(1, collapsed.size());
    std::vector<int>       occ(n, 0);
    for (int c : collapsed)
        ++occ[c];

    // Allowed-head set per colour, shrunk by pins; a colour is "mandatory" (must
    // occupy a physical slot) when it is used or pinned.
    std::vector<std::vector<char>> allowed(n, std::vector<char>(H, 1));
    std::vector<char>              pinned(n, 0);
    for (int c = 0; c < static_cast<int>(pins.size()) && c < n; ++c) {
        const PlanPin& p = pins[c];
        if (p.head < 0 && p.ace_unit < 0 && p.slot < 0)
            continue;
        pinned[c] = 1;
        if (p.head >= 0) {
            if (p.head >= H)
                return best; // pin to a head that does not exist
            std::fill(allowed[c].begin(), allowed[c].end(), char(0));
            allowed[c][p.head] = 1;
        } else if (p.ace_unit >= 0) {
            bool any = false;
            for (int h = 0; h < H; ++h) {
                allowed[c][h] = (heads[h].ace && heads[h].ace_unit == p.ace_unit) ? 1 : 0;
                any |= (allowed[c][h] != 0);
            }
            if (!any)
                return best; // pin to an ACE unit no head is fed by
        }
    }
    std::vector<int> mandatory;
    for (int c = 0; c < n; ++c)
        if (occ[c] > 0 || pinned[c])
            mandatory.push_back(c);
    if (static_cast<int>(mandatory.size()) > total_cap)
        return best; // infeasible: more needed spools than slots

    // Ordering: forced colours (single allowed head) first — placed with zero
    // branching — then busiest first so the swap-sensitive decisions happen high in
    // the tree where pruning bites hardest. Colour index breaks every tie so the
    // result does not depend on std::sort stability.
    std::vector<int> choice(n, 0);
    for (int c = 0; c < n; ++c)
        for (int h = 0; h < H; ++h)
            choice[c] += allowed[c][h];
    std::vector<int> order = mandatory;
    std::sort(order.begin(), order.end(), [&](int a, int b) {
        const bool fa = choice[a] <= 1, fb = choice[b] <= 1;
        if (fa != fb)
            return fa;
        if (occ[a] != occ[b])
            return occ[a] > occ[b];
        return a < b;
    });
    const int m = static_cast<int>(order.size());

    // --- search state ---------------------------------------------------------
    std::vector<int> assign(n, -1);
    std::vector<int> load(H, 0); // colours placed on each head
    std::vector<int> runs(H, 0); // runs of each head's restricted subsequence
    int              swaps_cur = 0;

    int              best_cost = std::numeric_limits<int>::max();
    std::vector<int> best_assign;

    // Delta in total swaps if colour c joins head h (recomputes only head h).
    auto place_delta = [&](int c, int h, int& new_runs) {
        new_runs = detail::runs_on_head(collapsed, assign, h, c);
        return std::max(0, new_runs - 1) - std::max(0, runs[h] - 1);
    };

    // --- greedy seed: cheapest allowed head each time -------------------------
    bool greedy_ok = true;
    for (int oi = 0; oi < m && greedy_ok; ++oi) {
        const int c       = order[oi];
        int       best_h  = -1, best_d = std::numeric_limits<int>::max(), best_r = 0;
        for (int h = 0; h < H; ++h) {
            if (!allowed[c][h] || load[h] >= cap[h])
                continue;
            int nr;
            const int d = place_delta(c, h, nr);
            if (d < best_d) {
                best_d = d;
                best_h = h;
                best_r = nr;
            }
        }
        if (best_h < 0) {
            greedy_ok = false; // pins can make the greedy order dead-end
            break;
        }
        assign[c] = best_h;
        ++load[best_h];
        runs[best_h] = best_r;
        swaps_cur += best_d;
    }
    if (greedy_ok) {
        best_cost   = swaps_cur;
        best_assign = assign;
    }

    // reset for the exact search
    std::fill(assign.begin(), assign.end(), -1);
    std::fill(load.begin(), load.end(), 0);
    std::fill(runs.begin(), runs.end(), 0);
    swaps_cur = 0;

    // --- branch and bound -----------------------------------------------------
    std::int64_t budget    = work_budget;
    bool         exhausted = false;

    struct Cand
    {
        int h, delta, new_runs;
    };

    std::function<void(int)> dfs = [&](int oi) {
        if (swaps_cur >= best_cost)
            return;
        if (oi == m) {
            best_cost   = swaps_cur;
            best_assign = assign;
            return;
        }
        if (budget <= 0) {
            exhausted = true;
            return;
        }
        // Admissible pigeonhole bound: every still-unassigned USED colour beyond the
        // heads that can still take a free first load costs at least one swap.
        int unassigned_used = 0;
        for (int i = oi; i < m; ++i)
            if (occ[order[i]] > 0)
                ++unassigned_used;
        int free_heads = 0;
        for (int h = 0; h < H; ++h)
            if (runs[h] == 0 && load[h] < cap[h])
                ++free_heads;
        if (swaps_cur + std::max(0, unassigned_used - free_heads) >= best_cost)
            return;

        const int         c = order[oi];
        std::vector<Cand> cands;
        cands.reserve(H);
        for (int h = 0; h < H; ++h) {
            if (!allowed[c][h] || load[h] >= cap[h])
                continue;
            // Symmetry-break across interchangeable empty heads: same capacity AND
            // the same allowed-set membership for every colour (pins distinguish
            // heads that would otherwise be identical).
            if (load[h] == 0) {
                bool dup = false;
                for (int h2 = 0; h2 < h && !dup; ++h2) {
                    if (load[h2] != 0 || cap[h2] != cap[h])
                        continue;
                    bool same = true;
                    for (int cc = 0; cc < n && same; ++cc)
                        same = (allowed[cc][h2] == allowed[cc][h]);
                    dup = same;
                }
                if (dup)
                    continue;
            }
            budget -= scan_cost;
            int nr;
            const int d = place_delta(c, h, nr);
            cands.push_back({h, d, nr});
        }
        // Cheapest first (head index breaks ties deterministically): reach good
        // solutions early so the bound tightens fast.
        std::sort(cands.begin(), cands.end(), [](const Cand& a, const Cand& b) {
            if (a.delta != b.delta)
                return a.delta < b.delta;
            return a.h < b.h;
        });
        for (const Cand& cd : cands) {
            const int old_runs = runs[cd.h];
            assign[c] = cd.h;
            ++load[cd.h];
            runs[cd.h] = cd.new_runs;
            swaps_cur += cd.delta;
            dfs(oi + 1);
            swaps_cur -= cd.delta;
            runs[cd.h] = old_runs;
            --load[cd.h];
            assign[c] = -1;
            if (exhausted)
                return;
        }
    };
    dfs(0);

    if (best_assign.empty())
        return best; // pins made every complete assignment impossible

    // Park unpinned-unused colours in leftover slots (they cost nothing); colours
    // that do not fit simply stay unloaded (head -1).
    std::vector<int> fin_load(H, 0);
    for (int c = 0; c < n; ++c)
        if (best_assign[c] >= 0)
            ++fin_load[best_assign[c]];
    for (int c = 0; c < n; ++c) {
        if (best_assign[c] >= 0)
            continue;
        for (int h = 0; h < H; ++h)
            if (allowed[c][h] && fin_load[h] < cap[h]) {
                best_assign[c] = h;
                ++fin_load[h];
                break;
            }
    }

    best.feasible = true;
    best.optimal  = !exhausted;
    best.swaps    = best_cost;
    best.head_of  = best_assign;

    // Slots: pinned slots are honoured first (when the pin resolved to the head the
    // colour actually sits on); everyone else fills the remaining slots in first-use
    // order (nice preload order: the colour a head presents first sits in its active
    // slot). Two colours pinned to the same physical slot is infeasible.
    std::vector<std::vector<char>> taken(H);
    for (int h = 0; h < H; ++h)
        taken[h].assign(cap[h], 0);
    for (int c = 0; c < static_cast<int>(pins.size()) && c < n; ++c) {
        const PlanPin& p = pins[c];
        const int      h = best.head_of[c];
        if (p.slot < 0 || h < 0 || choice[c] != 1)
            continue; // slot pins only bind when the pin resolved to a single head
        if (p.slot >= cap[h] || taken[h][p.slot]) {
            LoadingPlan bad;
            bad.head_of.assign(n, -1);
            bad.slot_of.assign(n, -1);
            return bad; // slot out of range, or two colours pinned to one slot
        }
        best.slot_of[c]  = p.slot;
        taken[h][p.slot] = 1;
    }
    auto lowest_free = [&](int h) {
        for (int s = 0; s < cap[h]; ++s)
            if (!taken[h][s])
                return s;
        return -1; // unreachable: capacity was respected
    };
    for (int c : collapsed) {
        const int h = best.head_of[c];
        if (h >= 0 && best.slot_of[c] < 0) {
            const int s = lowest_free(h);
            best.slot_of[c] = s;
            taken[h][s]     = 1;
        }
    }
    for (int c = 0; c < n; ++c) { // parked-but-unused colours also get their slot
        const int h = best.head_of[c];
        if (h >= 0 && best.slot_of[c] < 0) {
            const int s = lowest_free(h);
            best.slot_of[c] = s;
            taken[h][s]     = 1;
        }
    }
    return best;
}

// Price a complete user-made ("manual mode") assignment without optimising it:
// validates capacities and returns the exact swap count the layout would cost, so
// the UI can show "your layout: N swaps — Auto would need M". head_of[c] may be -1
// only for colours the sequence never uses (an unused filament need not be loaded);
// a used colour left unassigned makes the layout infeasible. `optimal` is always
// false: it is the user's layout, not a proven optimum.
inline LoadingPlan evaluate_assignment(const std::vector<PlanHead>& heads,
                                       const std::vector<int>&      sequence,
                                       int                          n,
                                       const std::vector<int>&      head_of)
{
    LoadingPlan out;
    if (n <= 0) {
        out.feasible = true;
        return out;
    }
    out.head_of.assign(n, -1);
    out.slot_of.assign(n, -1);
    const int H = static_cast<int>(heads.size());
    if (H == 0 || static_cast<int>(head_of.size()) < n)
        return out;

    const std::vector<int> collapsed = collapse_runs(sequence, n);
    std::vector<int>       occ(n, 0);
    for (int c : collapsed)
        ++occ[c];

    std::vector<int> load(H, 0);
    for (int c = 0; c < n; ++c) {
        const int h = head_of[c];
        if (h < 0) {
            if (occ[c] > 0)
                return out; // a printed colour must be loaded somewhere
            continue;
        }
        if (h >= H)
            return out;
        if (++load[h] > std::max(1, heads[h].capacity))
            return out; // over capacity
    }
    out.feasible = true;
    out.swaps    = simulate_swaps(collapsed, head_of, H);
    std::copy(head_of.begin(), head_of.begin() + n, out.head_of.begin());
    std::vector<int> next_slot(H, 0);
    for (int c : collapsed)
        if (out.slot_of[c] < 0)
            out.slot_of[c] = next_slot[out.head_of[c]]++;
    for (int c = 0; c < n; ++c)
        if (out.slot_of[c] < 0 && out.head_of[c] >= 0)
            out.slot_of[c] = next_slot[out.head_of[c]]++;
    return out;
}

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuPlan_hpp_
