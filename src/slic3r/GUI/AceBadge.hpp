#ifndef slic3r_GUI_AceBadge_hpp_
#define slic3r_GUI_AceBadge_hpp_

// The ACE unit, drawn. docs/ace-mmu/16-ace-visuals.md settles one treatment - outlined chassis,
// solid bays - in three proportions; this is the filled badge, form A, at 44x26.
//
// Drawn rather than shipped as an icon. It has to carry four live slot colours, so an asset would
// need one file per colour combination; and icon SVGs go through nanosvg (BitmapCache.cpp), which
// has no patterns and could not carry them anyway.
//
// Four bays is not a variable: /api/state returns exactly four slots and SLOT_COUNT is a constant.
// There is no single-bay form - an AMS Lite has one spool, an ACE never does.

#include "libslic3r/AceMmuState.hpp"

#include <wx/window.h>

#include <array>
#include <optional>
#include <string>

namespace Slic3r { namespace GUI {

class AceBadge : public wxWindow
{
public:
    // The nominal drawing is 44x26; `height_dip` scales both axes together.
    explicit AceBadge(wxWindow *parent, int height_dip = 26);

    // Bay colours as "#rrggbb", empty for an empty bay. Fewer than four leaves the rest empty.
    void SetSlots(const std::vector<std::string> &colors_rrggbb);

    // Every bay from a unit the panel has read. Convenience over SetSlots.
    void SetUnit(const AceMmu::AceUnit &unit);

    // A unit the preset names but the panel has not read, or one configured and not answering:
    // drawn in the disabled greys rather than as four empty bays, because empty is a claim.
    void SetUnknown();

    wxSize DoGetBestSize() const override { return m_size; }

private:
    void render(wxDC &dc);
    void paintEvent(wxPaintEvent &evt);

    std::array<std::optional<wxColour>, AceMmu::SLOT_COUNT> m_bays;
    bool   m_unknown = true;
    wxSize m_size;
    double m_scale = 1.0;
};

}} // namespace Slic3r::GUI

#endif // slic3r_GUI_AceBadge_hpp_
