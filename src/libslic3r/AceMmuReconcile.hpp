#ifndef slic3r_AceMmuReconcile_hpp_
#define slic3r_AceMmuReconcile_hpp_

// Compare a multiACE loading plan against what the printer says is actually in its ACE
// slots. Orca decides "slot 2 holds the magenta"; without this, nothing checks the machine
// agrees, and a plan that contradicts the loaded spools prints the wrong colours at full
// speed without a word.
//
// The verdict is deliberately THREE-valued, not two. AceSlot::identity_trusted() already
// distinguishes a spool the ACE read from RFID (or that the user named by hand) from one it
// merely inferred. Reporting "wrong filament" when the machine simply does not know what it
// is holding would be a false accusation, and a check that cries wolf gets ignored - which
// costs more than having no check at all.
//
// Facts only: this says what agrees and what does not. Whether a mismatch warns, blocks, or
// re-plans is a policy decision that lives in the GUI.
// See docs/ace-mmu/reconciliation-mockup.html.
//
// Pure/header-only (no GUI, no printer, no wx) so it unit-tests under tests/libslic3r.

#include <algorithm>
#include <cctype>
#include <string>
#include <vector>

#include "AceMmuPlan.hpp"
#include "AceMmuState.hpp"

namespace Slic3r { namespace AceMmu {

enum class SlotVerdict {
    Agrees,     // the loaded spool is the one the plan expects
    Differs,    // the machine is sure, and it is not what the plan expects (incl. empty)
    Unverified, // something is loaded but the machine cannot say what
    Unused,     // the plan puts no filament in this slot
};

// One ACE slot, judged.
struct SlotCheck
{
    int         unit     = 0;  // ACE unit index
    int         slot     = 0;  // slot within the unit
    int         filament = -1; // project filament the plan puts here (-1 = none)
    SlotVerdict verdict  = SlotVerdict::Unused;

    // What the plan expects, and what is actually there - both as the UI needs to show them.
    std::string expect_colour;   // "#rrggbb", lowercase, empty if unknown
    std::string expect_material; // "PLA"
    std::string actual_colour;
    std::string actual_material;
    std::string actual_name; // brand/sku if the machine offered one
    bool        actual_occupied = false;
};

struct Reconciliation
{
    bool                   checked = false; // false = no snapshot; say so, never imply agreement
    std::vector<SlotCheck> slots;

    size_t count(SlotVerdict v) const
    {
        return size_t(std::count_if(slots.begin(), slots.end(), [v](const SlotCheck& s) { return s.verdict == v; }));
    }
    // Only a verdict the machine is sure of. Unverified slots are not "wrong", and lumping
    // them in would make the common case (a spool with no tag) look like an error.
    bool any_mismatch() const { return count(SlotVerdict::Differs) > 0; }
};

namespace detail {

inline std::string norm_hex(std::string s)
{
    if (!s.empty() && s.front() == '#')
        s.erase(s.begin());
    // Project colours may carry an alpha byte ("#RRGGBBAA"); the ACE never reports one.
    if (s.size() > 6)
        s.resize(6);
    for (char& c : s)
        c = char(std::tolower((unsigned char) c));
    return s;
}

inline std::string norm_material(std::string s)
{
    std::string out;
    out.reserve(s.size());
    for (char c : s)
        if (!std::isspace((unsigned char) c))
            out.push_back(char(std::toupper((unsigned char) c)));
    return out;
}

} // namespace detail

// Colour AND material, brand ignored. Colour alone would pass PLA where PETG is loaded,
// which is a temperature problem rather than a cosmetic one; adding brand would flag a
// Kingroon-vs-Generic difference nobody cares about. An unknown on either side does not
// match: silence is not agreement.
inline bool spool_matches(const std::string& want_colour,
                          const std::string& want_material,
                          const std::string& have_colour,
                          const std::string& have_material)
{
    const std::string wc = detail::norm_hex(want_colour), hc = detail::norm_hex(have_colour);
    const std::string wm = detail::norm_material(want_material), hm = detail::norm_material(have_material);
    if (wc.empty() || hc.empty() || wc != hc)
        return false;
    // A material the project or the machine leaves blank cannot contradict the other, and
    // the colour already agrees - accept rather than invent a mismatch.
    if (wm.empty() || hm.empty())
        return true;
    return wm == hm;
}

// Judge every ACE slot the plan uses against the snapshot.
//   plan     - filament -> (head, slot), as Print::ace_plan()
//   head_unit- per head, which ACE unit feeds it (-1 = stock feeder, never checked)
//   colours  - per filament, project colour ("#rrggbb" or "#rrggbbaa")
//   materials- per filament, project filament type ("PLA")
// An empty snapshot (no units) yields checked=false: nothing was read, so nothing is claimed.
inline Reconciliation reconcile(const AceSnapshot&              snapshot,
                                const LoadingPlan&              plan,
                                const std::vector<int>&         head_unit,
                                const std::vector<std::string>& colours,
                                const std::vector<std::string>& materials)
{
    Reconciliation out;
    if (snapshot.units.empty() || !plan.feasible)
        return out;
    out.checked = true;

    // Slots first, so a unit with nothing planned in it still reports its contents rather
    // than vanishing from the comparison.
    for (const AceUnit& unit : snapshot.units) {
        for (const AceSlot& slot : unit.slots) {
            SlotCheck c;
            c.unit            = unit.idx;
            c.slot            = slot.idx;
            c.actual_occupied = slot.occupied;
            c.actual_colour   = slot.color_rrggbb;
            c.actual_material = slot.material;
            c.actual_name     = slot.brand.empty() ? slot.sku : slot.brand;

            // Which filament does the plan put here? Only heads wired to this unit count:
            // slot numbering is per head, and two heads can be fed by different units.
            for (size_t f = 0; f < plan.head_of.size(); ++f) {
                const int h = plan.head_of[f];
                if (h < 0 || f >= plan.slot_of.size() || plan.slot_of[f] != slot.idx)
                    continue;
                const int u = (size_t(h) < head_unit.size()) ? head_unit[h] : -1;
                if (u != unit.idx)
                    continue;
                c.filament = int(f);
                break;
            }

            if (c.filament < 0) {
                c.verdict = SlotVerdict::Unused;
                out.slots.push_back(c);
                continue;
            }
            c.expect_colour   = size_t(c.filament) < colours.size() ? colours[c.filament] : std::string();
            c.expect_material = size_t(c.filament) < materials.size() ? materials[c.filament] : std::string();

            if (!slot.occupied)
                // Nothing there at all. The machine is not guessing about an empty slot, so
                // this is a mismatch however untrusted its identity handling may be.
                c.verdict = SlotVerdict::Differs;
            else if (!slot.identity_trusted())
                c.verdict = SlotVerdict::Unverified;
            else
                c.verdict = spool_matches(c.expect_colour, c.expect_material, c.actual_colour, c.actual_material) ? SlotVerdict::Agrees :
                                                                                                                    SlotVerdict::Differs;
            out.slots.push_back(c);
        }
    }
    return out;
}

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuReconcile_hpp_
