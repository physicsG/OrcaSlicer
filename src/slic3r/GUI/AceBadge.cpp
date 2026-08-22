#include "AceBadge.hpp"

#include <wx/dcbuffer.h>
#include <wx/dcgraph.h>

namespace Slic3r { namespace GUI {

// The neutrals are Orca's own AMS roles, so the badge sits in the same palette as every other
// filament surface rather than introducing a second one (docs/ace-mmu/16-ace-visuals.md).
static const wxColour ACE_HOOD    = wxColour(0xE8, 0xE8, 0xE8);
static const wxColour ACE_BASE    = wxColour(0xCF, 0xCF, 0xCF);
static const wxColour ACE_EMPTY   = wxColour(0xFF, 0xFF, 0xFF);
static const wxColour ACE_DISABLE = wxColour(0xCE, 0xCE, 0xCE); // AMS_CONTROL_DISABLE_COLOUR
static const wxColour ACE_BLOCK   = wxColour(0xEE, 0xEE, 0xEE); // AMS_CONTROL_DEF_BLOCK_BK_COLOUR

// "#83AFFF" -> wxColour. Anything else is no colour at all, which draws as an empty bay.
static std::optional<wxColour> parse_hash_rgb(const std::string &s)
{
    if (s.size() != 7 || s.front() != '#')
        return std::nullopt;
    wxColour c(wxString::FromUTF8(s));
    if (!c.IsOk())
        return std::nullopt;
    return c;
}

AceBadge::AceBadge(wxWindow *parent, int height_dip) : wxWindow(parent, wxID_ANY, wxDefaultPosition, wxDefaultSize)
{
    const int h = FromDIP(height_dip);
    m_scale     = double(h) / 26.0;
    m_size      = wxSize(int(std::lround(44.0 * m_scale)), h);

    SetBackgroundStyle(wxBG_STYLE_PAINT);
    SetMinSize(m_size);
    SetMaxSize(m_size);
    SetSize(m_size);
    Bind(wxEVT_PAINT, &AceBadge::paintEvent, this);
}

void AceBadge::SetSlots(const std::vector<std::string> &colors_rrggbb)
{
    m_unknown = false;
    for (size_t i = 0; i < m_bays.size(); ++i)
        m_bays[i] = i < colors_rrggbb.size() ? parse_hash_rgb(colors_rrggbb[i]) : std::nullopt;
    Refresh();
}

void AceBadge::SetUnit(const AceMmu::AceUnit &unit)
{
    m_unknown = false;
    m_bays.fill(std::nullopt);
    for (const AceMmu::AceSlot &s : unit.slots) {
        if (s.idx < 0 || size_t(s.idx) >= m_bays.size())
            continue;
        // An unoccupied slot is empty whatever colour it last carried.
        m_bays[s.idx] = s.occupied ? parse_hash_rgb(s.color_rrggbb) : std::nullopt;
    }
    Refresh();
}

void AceBadge::SetUnknown()
{
    m_unknown = true;
    m_bays.fill(std::nullopt);
    Refresh();
}

void AceBadge::render(wxDC &dc)
{
    const double z = m_scale;
    const auto   S = [z](double v) { return int(std::lround(v * z)); };

    dc.SetPen(*wxTRANSPARENT_PEN);

    // The hood: x 2..40, top corners rounded at 7. Its bottom corners are rounded too and then
    // covered by the base, which is what gives the cabinet its stepped silhouette.
    dc.SetBrush(wxBrush(m_unknown ? ACE_BLOCK : ACE_HOOD));
    dc.DrawRoundedRectangle(S(2), S(2), S(38), S(24), S(7));

    // Four bays, 5x14 capsules at x 6/15/24/33 - padding 4 equals gap 4.
    for (int i = 0; i < AceMmu::SLOT_COUNT; ++i) {
        const wxColour fill = m_unknown ? ACE_DISABLE : (m_bays[i] ? *m_bays[i] : ACE_EMPTY);
        dc.SetBrush(wxBrush(fill));
        dc.DrawRoundedRectangle(S(6 + i * 9), S(4.5), S(5), S(14), S(2.5));
    }

    // The base, drawn over the bays and slightly wider than the hood: that width difference is
    // what makes the shape read as a cabinet rather than a bar chart.
    dc.SetBrush(wxBrush(m_unknown ? ACE_DISABLE : ACE_BASE));
    dc.DrawRoundedRectangle(0, S(16), S(44), S(10), S(1.5));
}

void AceBadge::paintEvent(wxPaintEvent &)
{
    wxAutoBufferedPaintDC dc(this);
    dc.SetBackground(wxBrush(GetParent() ? GetParent()->GetBackgroundColour() : *wxWHITE));
    dc.Clear();
#ifdef __WXMSW__
    // GTK's wxDC is already Cairo-backed; MSW's is not, and a 2.5px capsule radius without
    // antialiasing reads as a rectangle.
    wxGCDC gdc(dc);
    render(gdc);
#else
    render(dc);
#endif
}

}} // namespace Slic3r::GUI
