#ifndef slic3r_AceMmuTopology_hpp_
#define slic3r_AceMmuTopology_hpp_

// The mapping between what the printer reports about its ACE wiring and what the printer preset
// stores about it - `ace_mode`, `ace_head_unit`, `ace_head_capacity`.
//
// Pure, and deliberately out of the GUI: the sidebar's Sync info writes these values, the sidebar's
// corner ticks diff against them, and TabPrinter's Multimaterial page reads the same thing. One
// function, so a tick cannot claim an agreement the next sync would undo.

#include "AceMmuState.hpp"
#include "Config.hpp"
#include "PrintConfig.hpp"

#include <string>
#include <vector>

namespace Slic3r { namespace AceMmu {

// What the preset would hold if it were made to agree with the machine.
struct AceTopology
{
    AceMode          mode = amNormal;
    std::vector<int> unit; // per head; -1 for a head on its own stock feeder
    std::vector<int> cap;  // per head; 1 for a stock feeder
};

// The firmware's own three words, through the same map the preset value is stored with, so "head"
// means amHead here and in the gcode. An unknown word is Normal: no ACE claimed.
inline AceMode ace_mode_from_string(const std::string &mode)
{
    const auto &values = ConfigOptionEnum<AceMode>::get_enum_values();
    const auto  it     = values.find(mode);
    return it == values.end() ? amNormal : AceMode(it->second);
}

// How many slots a unit offers. Four unless the machine says otherwise - SLOT_COUNT is a constant
// in the protocol, but a unit that reported a shorter list is believed over the constant.
inline int ace_unit_capacity(const AceSnapshot &snap, int unit_idx)
{
    for (const AceUnit &u : snap.units)
        if (u.idx == unit_idx && !u.slots.empty())
            return int(u.slots.size());
    return SLOT_COUNT;
}

inline AceTopology ace_topology_of(const AceSnapshot &snap, size_t head_count)
{
    AceTopology topo;
    topo.mode = ace_mode_from_string(snap.mode);

    for (size_t h = 0; h < head_count; ++h) {
        int cap = 1, unit = -1; // no ACE reported for this head means its own feeder
        for (const AceToolhead &th : snap.toolheads) {
            if (size_t(th.idx) != h)
                continue;
            // `feeder` is the flag to trust, not `ace`. head_ace carries a default unit for every
            // head, so a machine with one ACE still reports {0:0, 1:1, 2:2, 3:0} there; on the live
            // U1 heads 1-3 are feeders, and reading their head_ace as wiring would invent two units
            // that are not plugged in.
            if (!th.feeder && th.ace.has_value()) {
                unit = *th.ace;
                cap  = ace_unit_capacity(snap, unit);
            }
            break;
        }
        topo.cap.push_back(cap);
        topo.unit.push_back(unit);
    }
    return topo;
}

// Whether head `h` in the preset says what the printer says. The mode decides whether per-head
// wiring means anything at all, so it is compared first; a head on its own feeder carries no unit,
// so the unit is only compared when there is one.
inline bool ace_head_agrees(const ConfigBase &cfg, const AceTopology &topo, size_t h)
{
    const auto *ace_mode = cfg.option<ConfigOptionEnum<AceMode>>("ace_mode");
    if (!ace_mode || AceMode(ace_mode->value) != topo.mode)
        return false;
    if (h >= topo.cap.size())
        return false;

    const auto *head_unit = cfg.option<ConfigOptionInts>("ace_head_unit");
    const auto *head_cap  = cfg.option<ConfigOptionInts>("ace_head_capacity");
    const int   was_cap   = (head_cap && h < head_cap->values.size()) ? head_cap->values[h] : 1;
    const int   was_unit  = (head_unit && h < head_unit->values.size()) ? head_unit->values[h] : -1;
    return was_cap == topo.cap[h] && (topo.cap[h] <= 1 || was_unit == topo.unit[h]);
}

// How the printer names a unit: protocol v2 is an ACE 2 Pro, v1 an ACE Pro. The same mapping
// resources/web/multiace/index.html uses, so the panel and the machine's own page agree.
inline std::string ace_unit_model(const AceUnit &unit)
{
    if (unit.protocol == "v2")
        return "ACE 2 Pro";
    if (unit.protocol == "v1")
        return "ACE Pro";
    return {};
}

}} // namespace Slic3r::AceMmu

#endif // slic3r_AceMmuTopology_hpp_
