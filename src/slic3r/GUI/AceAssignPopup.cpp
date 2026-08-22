#include "AceAssignPopup.hpp"

#include "AceBadge.hpp"
#include "GUI.hpp"
#include "GUI_App.hpp"
#include "I18N.hpp"
#include "Widgets/Label.hpp"
#include "Widgets/StaticBox.hpp"
#include "libslic3r/AceMmuTopology.hpp"

#include <wx/dcbuffer.h>
#include <wx/sizer.h>

namespace Slic3r { namespace GUI {

static const wxColour ROW_HOVER  = wxColour(0xF2, 0xF7, 0xF4);
static const wxColour ROW_INK    = wxColour(0x4A, 0x52, 0x58);
static const wxColour ROW_DIM    = wxColour(0x6B, 0x72, 0x76);
static const wxColour ORCA_GREEN = wxColour(0x00, 0xAE, 0x42);
static const wxColour TICK_OFF   = wxColour(0xCE, 0xCE, 0xCE);

// The stock feeder's mark: one spool loaded straight at the head. Deliberately not an ACE form -
// the whole point of the row is that no unit addresses it.
class FeederMark : public wxWindow
{
public:
    explicit FeederMark(wxWindow *parent, int size_dip = 24) : wxWindow(parent, wxID_ANY)
    {
        const int h = FromDIP(size_dip);
        m_size      = wxSize(h, h); // square, to sit in the same column as the S4 glyph
        SetBackgroundStyle(wxBG_STYLE_PAINT);
        SetMinSize(m_size);
        SetMaxSize(m_size);
        Bind(wxEVT_PAINT, [this](wxPaintEvent &) {
            wxAutoBufferedPaintDC dc(this);
            dc.SetBackground(wxBrush(GetParent()->GetBackgroundColour()));
            dc.Clear();
            const wxSize sz = GetSize();
            const int    r  = std::min(sz.x, sz.y) / 2 - FromDIP(3);
            const wxPoint c(sz.x / 2, sz.y / 2);
            dc.SetPen(wxPen(ROW_DIM, std::max(1, FromDIP(2))));
            dc.SetBrush(*wxTRANSPARENT_BRUSH);
            dc.DrawCircle(c, r);
            dc.SetPen(*wxTRANSPARENT_PEN);
            dc.SetBrush(wxBrush(ROW_DIM));
            dc.DrawCircle(c, std::max(1, r / 3));
        });
    }
    wxSize DoGetBestSize() const override { return m_size; }

private:
    wxSize m_size;
};

// The tick: a filled disc with a check when chosen, an empty ring when not. Same grammar as the
// mode dropdown, so one reading covers both lists.
class ChoiceTick : public wxWindow
{
public:
    ChoiceTick(wxWindow *parent, bool on) : wxWindow(parent, wxID_ANY), m_on(on)
    {
        const int d = FromDIP(19);
        m_size      = wxSize(d, d);
        SetBackgroundStyle(wxBG_STYLE_PAINT);
        SetMinSize(m_size);
        SetMaxSize(m_size);
        Bind(wxEVT_PAINT, [this](wxPaintEvent &) {
            wxAutoBufferedPaintDC dc(this);
            dc.SetBackground(wxBrush(GetParent()->GetBackgroundColour()));
            dc.Clear();
            const wxSize sz = GetSize();
            const int    r  = std::min(sz.x, sz.y) / 2 - 1;
            const wxPoint c(sz.x / 2, sz.y / 2);
            if (m_on) {
                dc.SetPen(*wxTRANSPARENT_PEN);
                dc.SetBrush(wxBrush(ORCA_GREEN));
                dc.DrawCircle(c, r);
                wxPen pen(*wxWHITE, std::max(1, FromDIP(2)));
                pen.SetCap(wxCAP_ROUND);
                pen.SetJoin(wxJOIN_ROUND);
                dc.SetPen(pen);
                const wxPoint check[3] = {{c.x - r / 2, c.y}, {c.x - r / 6, c.y + r / 2}, {c.x + r / 2, c.y - r / 2}};
                dc.DrawLines(3, check);
            } else {
                dc.SetPen(wxPen(TICK_OFF, std::max(1, FromDIP(1))));
                dc.SetBrush(*wxTRANSPARENT_BRUSH);
                dc.DrawCircle(c, r);
            }
        });
    }
    wxSize DoGetBestSize() const override { return m_size; }

private:
    bool   m_on;
    wxSize m_size;
};

AceAssignPopup::AceAssignPopup(wxWindow                  *parent,
                               size_t                     head_idx,
                               const std::vector<int>    &head_unit,
                               const std::vector<int>    &head_cap,
                               const AceMmu::AceSnapshot &snap,
                               bool                       snap_valid)
    : PopupWindow(parent, wxBORDER_NONE), m_head_idx(head_idx)
{
    SetBackgroundColour(*wxWHITE);

    const int cur_unit = head_idx < head_unit.size() ? head_unit[head_idx] : -1;
    const int cur_cap  = head_idx < head_cap.size() ? head_cap[head_idx] : 1;
    const bool on_feeder = cur_cap <= 1;

    wxBoxSizer *sizer = new wxBoxSizer(wxVERTICAL);
    sizer->AddSpacer(FromDIP(10));

    const wxString title = wxString::Format(_L("Which ACE feeds Toolhead %d?"), int(head_idx) + 1);
    auto *question = new Label(this, Label::Head_14, title);
    question->SetForegroundColour(ROW_INK);
    // Label applies the font after wxStaticText has already cached a best size for the default
    // one, so a heading font measures short and the sizer clips the tail - here, the head number.
    // Measure it again through the label's own font and say so.
    question->SetMinSize(wxSize(question->GetTextExtent(title).x + FromDIP(2), -1));
    sizer->Add(question, 0, wxLEFT | wxRIGHT, FromDIP(14));
    sizer->AddSpacer(FromDIP(8));

    add_row(this, sizer, -1, 1, _L("Stock feeder"), _L("One spool, loaded at the head"), on_feeder, nullptr);

    // With a reading, the units the machine reports. Without one, the four `ace_head_unit` accepts:
    // the preset has to be settable with the printer switched off, and inventing detail for a unit
    // nobody has spoken to would be worse than offering it plainly.
    std::vector<int> unit_indices;
    if (snap_valid) {
        for (const AceMmu::AceUnit &u : snap.units)
            if (u.idx >= 0)
                unit_indices.push_back(u.idx);
    }
    if (unit_indices.empty())
        for (int i = 0; i < 4; ++i)
            unit_indices.push_back(i);

    for (int idx : unit_indices) {
        const AceMmu::AceUnit *live = snap_valid ? snap.find_unit(idx) : nullptr;
        const int              cap  = live ? AceMmu::ace_unit_capacity(snap, idx) : AceMmu::SLOT_COUNT;

        wxString title = wxString::Format(_L("ACE %d"), idx + 1);
        if (live) {
            const std::string model = AceMmu::ace_unit_model(*live);
            if (!model.empty())
                title += " " + wxString::FromUTF8("\xC2\xB7") + " " + wxString::FromUTF8(model);
        }

        // What the row can honestly say about this unit.
        wxString detail = wxString::Format(_L("%d slots"), cap);
        if (live) {
            detail += " " + wxString::FromUTF8("\xC2\xB7") + " " +
                      (live->connected ? _L("connected") : _L("not answering"));
            if (live->humidity)
                detail += " " + wxString::FromUTF8("\xC2\xB7") + " " + wxString::Format(_L("%d%% RH"), *live->humidity);
        } else if (snap_valid) {
            detail += " " + wxString::FromUTF8("\xC2\xB7") + " " + _L("not reported by the printer");
        }

        // A unit may feed more than one head; naming the others is what makes the shared capacity
        // legible before the choice rather than after it.
        std::vector<int> also;
        for (size_t h = 0; h < head_unit.size(); ++h)
            if (h != head_idx && head_unit[h] == idx && h < head_cap.size() && head_cap[h] > 1)
                also.push_back(int(h) + 1);
        for (size_t i = 0; i < also.size(); ++i)
            detail += (i == 0 ? "\n" + _L("Also feeds") + " " : ", ") + wxString::Format(_L("Toolhead %d"), also[i]);

        add_row(this, sizer, idx, cap, title, detail, !on_feeder && cur_unit == idx, live);
    }

    sizer->AddSpacer(FromDIP(10));
    SetSizerAndFit(sizer);
}

void AceAssignPopup::add_row(wxWindow *parent, wxSizer *sizer, int unit, int cap, const wxString &title,
                             const wxString &detail, bool ticked, const AceMmu::AceUnit *live)
{
    auto *row = new wxPanel(parent, wxID_ANY);
    row->SetBackgroundColour(ticked ? ROW_HOVER : parent->GetBackgroundColour());
    row->SetCursor(wxCURSOR_HAND);

    wxWindow *mark = nullptr;
    if (unit < 0) {
        mark = new FeederMark(row);
    } else {
        // S4, the square front face - doc 16 gives the wide filled badge to a head box and the
        // square line form to a menu, which is what this list is. It carries no slot colours by
        // design: the row is choosing a unit, and what is loaded in it is the detail line's job.
        auto *badge = new AceBadge(row, 24, AceBadge::Form::SquareFace);
        badge->SetInk(ROW_INK);
        if (live)
            badge->SetUnit(*live);
        else
            badge->SetUnknown();
        mark = badge;
    }

    auto *name = new Label(row, Label::Body_13, title, LB_PROPAGATE_MOUSE_EVENT);
    name->SetForegroundColour(ROW_INK);
    auto *sub = new Label(row, Label::Body_10, detail, LB_PROPAGATE_MOUSE_EVENT);
    sub->SetForegroundColour(ROW_DIM);

    auto *tick = new ChoiceTick(row, ticked);

    wxBoxSizer *text = new wxBoxSizer(wxVERTICAL);
    text->Add(name, 0, wxEXPAND);
    text->Add(sub, 0, wxEXPAND | wxTOP, FromDIP(1));

    wxBoxSizer *hs = new wxBoxSizer(wxHORIZONTAL);
    hs->Add(mark, 0, wxALIGN_CENTER_VERTICAL | wxLEFT, FromDIP(14));
    hs->Add(text, 1, wxALIGN_CENTER_VERTICAL | wxLEFT, FromDIP(10));
    hs->Add(tick, 0, wxALIGN_CENTER_VERTICAL | wxLEFT | wxRIGHT, FromDIP(12));
    row->SetSizer(hs);

    // The whole row is the target, and every child that could swallow a click forwards it: a
    // 19px tick is not a hit box, and the badge is the most obvious thing to aim at.
    const auto choose = [this, unit, cap](wxMouseEvent &) {
        auto cb = m_choice;
        Dismiss();
        if (cb)
            cb(unit, cap);
    };
    row->Bind(wxEVT_LEFT_UP, choose);
    mark->Bind(wxEVT_LEFT_UP, choose);
    tick->Bind(wxEVT_LEFT_UP, choose);

    const wxColour base = ticked ? ROW_HOVER : parent->GetBackgroundColour();
    for (wxWindow *w : {static_cast<wxWindow *>(row), mark, static_cast<wxWindow *>(tick)}) {
        w->Bind(wxEVT_ENTER_WINDOW, [row, base](wxMouseEvent &e) { e.Skip(); row->SetBackgroundColour(ROW_HOVER); row->Refresh(); });
        w->Bind(wxEVT_LEAVE_WINDOW, [row, base](wxMouseEvent &e) { e.Skip(); row->SetBackgroundColour(base); row->Refresh(); });
    }

    sizer->Add(row, 0, wxEXPAND | wxTOP | wxBOTTOM, FromDIP(1));
}

void AceAssignPopup::OnDismiss() { CallAfter([this]() { Destroy(); }); }

void AceAssignPopup::popup_at(wxWindow *anchor)
{
    // Below the control that opened it, left edges aligned, pulled back onto the screen if the
    // sidebar sits near the bottom.
    wxPoint pos = anchor->ClientToScreen(wxPoint(0, anchor->GetSize().y + 2));
    const wxSize   sz   = GetSize();
    const wxRect   area = wxDisplay(wxDisplay::GetFromWindow(anchor) == wxNOT_FOUND ? 0 : wxDisplay::GetFromWindow(anchor)).GetClientArea();
    if (pos.y + sz.y > area.GetBottom())
        pos.y = std::max(area.GetTop(), anchor->ClientToScreen(wxPoint(0, 0)).y - sz.y - 2);
    if (pos.x + sz.x > area.GetRight())
        pos.x = std::max(area.GetLeft(), area.GetRight() - sz.x);
    Position(pos, wxSize(0, 0));
    Popup();
}

}} // namespace Slic3r::GUI
