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
    // The three forms doc 16 settles, under one rule: outlined chassis, solid bays.
    enum class Form {
        Cabinet,    // A - 44x26 filled. A head box's ACE row; carries the slot colours.
        SquareFace, // S4 - 24x24 line. A menu row, a tab, a ScalableButton. Deliberately NOT the
                    // same silhouette: it has a third of the width to say the same thing in, so
                    // the family is carried by the bay treatment and the stroke, not the hood.
    };

    // The nominal drawing is 44x26 for Cabinet and 24x24 for SquareFace; `height_dip` scales
    // both axes of whichever form together.
    explicit AceBadge(wxWindow *parent, int height_dip = 26, Form form = Form::Cabinet);

    // SquareFace draws in one ink rather than in slot colours; this is that ink.
    void SetInk(const wxColour &ink);

    // Bay colours as "#rrggbb", empty for an empty bay. Fewer than four leaves the rest empty.
    void SetSlots(const std::vector<std::string> &colors_rrggbb);

    // Every bay from a unit the panel has read. Convenience over SetSlots.
    void SetUnit(const AceMmu::AceUnit &unit);

    // A unit the preset names but the panel has not read, or one configured and not answering:
    // drawn in the disabled greys rather than as four empty bays, because empty is a claim.
    void SetUnknown();

    wxSize DoGetBestSize() const override { return m_size; }

private:
    void render_cabinet(wxDC &dc);
    void render_square(wxDC &dc);
    void paintEvent(wxPaintEvent &evt);

    std::array<std::optional<wxColour>, AceMmu::SLOT_COUNT> m_bays;
    bool     m_unknown = true;
    Form     m_form    = Form::Cabinet;
    wxColour m_ink;
    wxSize   m_size;
    double   m_scale = 1.0;
};

}} // namespace Slic3r::GUI

#endif // slic3r_GUI_AceBadge_hpp_
