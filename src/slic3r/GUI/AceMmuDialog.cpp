#include "AceMmuDialog.hpp"
#include "DeviceManager.hpp"
#include "AceMmuProvider.hpp"
#include "libslic3r/AceMmuState.hpp"

#include <wx/sizer.h>
#include <wx/stattext.h>
#include <wx/statline.h>
#include <wx/panel.h>
#include <wx/button.h>
#include <wx/settings.h>
#include <wx/font.h>
#include <boost/log/trivial.hpp>

namespace Slic3r { namespace GUI {

namespace {

wxColour dim_text() { return wxSystemSettings::GetColour(wxSYS_COLOUR_GRAYTEXT); }
wxColour card_bg() { return wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE); }

// Stable reference for the `const wxColour*` label() param.
const wxColour& dim_text_ref()
{
    static wxColour c = dim_text();
    return c;
}
const wxColour kAccent(23, 184, 144);
const wxColour kWarn(214, 152, 60);

wxStaticText* label(wxWindow* p, const wxString& text, int dpt = 0, bool bold = false, const wxColour* col = nullptr)
{
    wxStaticText* t = new wxStaticText(p, wxID_ANY, text);
    wxFont        f = t->GetFont();
    if (dpt)
        f.SetPointSize(f.GetPointSize() + dpt);
    if (bold)
        f.MakeBold();
    t->SetFont(f);
    if (col)
        t->SetForegroundColour(*col);
    return t;
}

// A small coloured pill, e.g. "RFID" / "OVERRIDE".
wxStaticText* chip(wxWindow* p, const wxString& text, const wxColour& col)
{
    wxStaticText* c = label(p, text, -1, true, &col);
    return c;
}

wxString head_material(const Slic3r::AceMmu::AceToolhead& t)
{
    if (!t.material.empty())
        return wxString::FromUTF8(t.material.c_str());
    return t.filament_detected ? wxString("Loaded") : wxString("Empty");
}

} // namespace

// One slot card: slot label, colour swatch, material, brand, identity chip + hex.
static wxPanel* make_slot_card(wxWindow* parent, const Slic3r::AceMmu::AceSlot& slot)
{
    wxPanel* card = new wxPanel(parent);
    card->SetMinSize(parent->FromDIP(wxSize(132, 176)));
    card->SetBackgroundColour(card_bg());

    wxBoxSizer* s = new wxBoxSizer(wxVERTICAL);
    s->Add(label(card, wxString::Format("Slot %d", slot.idx + 1), 0, true), 0, wxLEFT | wxTOP, card->FromDIP(8));

    wxPanel* swatch = new wxPanel(card);
    swatch->SetMinSize(card->FromDIP(wxSize(58, 58)));
    if (slot.occupied) {
        wxColour c = slot.color_rrggbb.empty() ? wxColour(150, 150, 150) : wxColour(wxString::FromUTF8(slot.color_rrggbb.c_str()));
        if (!c.IsOk())
            c = wxColour(150, 150, 150);
        swatch->SetBackgroundColour(c);
    } else {
        swatch->SetBackgroundColour(wxColour(120, 120, 120, 40));
    }
    s->Add(swatch, 0, wxALIGN_CENTER | wxTOP | wxBOTTOM, card->FromDIP(12));

    if (slot.occupied) {
        wxString mat = slot.material.empty() ? wxString("Loaded") : wxString::FromUTF8(slot.material.c_str());
        s->Add(label(card, mat, 0, true), 0, wxALIGN_CENTER);
        if (!slot.brand.empty())
            s->Add(label(card, wxString::FromUTF8(slot.brand.c_str()), -1, false, &dim_text_ref()), 0, wxALIGN_CENTER | wxTOP,
                   card->FromDIP(1));

        wxBoxSizer* foot = new wxBoxSizer(wxHORIZONTAL);
        if (slot.source == "rfid")
            foot->Add(chip(card, "RFID", kAccent), 0, wxRIGHT, card->FromDIP(6));
        else if (slot.source == "override")
            foot->Add(chip(card, "OVERRIDE", kWarn), 0, wxRIGHT, card->FromDIP(6));
        if (!slot.color_rrggbb.empty()) {
            wxString hex = wxString::FromUTF8(slot.color_rrggbb.c_str()).Upper();
            foot->Add(label(card, hex, -1, false, &dim_text_ref()), 0);
        }
        s->Add(foot, 0, wxALIGN_CENTER | wxTOP, card->FromDIP(8));
    } else {
        s->Add(label(card, "Empty", 0, false, &dim_text_ref()), 0, wxALIGN_CENTER);
    }

    card->SetSizer(s);
    return card;
}

AceMmuDialog::AceMmuDialog(wxWindow* parent, MachineObject* obj)
    : wxDialog(parent, wxID_ANY, "ACE MMU", wxDefaultPosition, wxDefaultSize, wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER), m_obj(obj)
{
    wxBoxSizer* top = new wxBoxSizer(wxVERTICAL);

    wxBoxSizer* headbar = new wxBoxSizer(wxHORIZONTAL);
    headbar->Add(label(this, "Snapmaker U1 · ACE MMU", 2, true), 0, wxALIGN_CENTER_VERTICAL);
    headbar->AddStretchSpacer();
    wxButton* refresh = new wxButton(this, wxID_ANY, "Refresh");
    refresh->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) { rebuild(); });
    headbar->Add(refresh, 0, wxALIGN_CENTER_VERTICAL);
    top->Add(headbar, 0, wxEXPAND | wxALL, FromDIP(14));

    m_body = new wxPanel(this);
    top->Add(m_body, 1, wxEXPAND | wxLEFT | wxRIGHT, FromDIP(8));

    wxButton* close = new wxButton(this, wxID_OK, "Close");
    top->Add(close, 0, wxALIGN_RIGHT | wxALL, FromDIP(12));

    SetSizer(top);
    rebuild();
}

void AceMmuDialog::rebuild()
{
    Freeze();
    m_body->DestroyChildren();
    wxBoxSizer* s = new wxBoxSizer(wxVERTICAL);

    // Fetch a fresh snapshot from the connected printer's host (the U1 usually has
    // no MachineObject dev_ip; resolve_connected_host falls back to the PrintHost).
    Slic3r::AceMmu::AceSnapshot snap;
    std::string                 host = AceMmuProvider::resolve_connected_host();
    if (host.empty() && m_obj)
        host = m_obj->dev_ip;
    bool fetched = false;
    if (!host.empty()) {
        AceMmuProvider prov(host);
        fetched = prov.fetch_once();
        if (fetched)
            snap = prov.snapshot();
    }
    BOOST_LOG_TRIVIAL(info) << "AceMmuDialog: host='" << host << "' fetched=" << fetched << " units=" << snap.units.size();
    if (m_obj && !snap.units.empty())
        m_obj->apply_ace_snapshot(snap); // keep amsList in sync for the Prepare flow

    if (snap.units.empty()) {
        s->Add(label(m_body, "No ACE unit detected.\nConnect the Snapmaker U1 and make sure the multiACE service is running.", 0, false,
                     &dim_text_ref()),
               0, wxALL, FromDIP(16));
    } else {
        for (const auto& unit : snap.units) {
            wxString hdr = wxString::Format("ACE Unit %d", unit.idx);
            if (!unit.protocol.empty())
                hdr += "  ·  " + wxString::FromUTF8(unit.protocol.c_str());
            hdr += unit.connected ? "  ·  connected" : "  ·  offline";
            if (unit.humidity)
                hdr += wxString::Format("  ·  Humidity %d%%", *unit.humidity);
            if (unit.temp)
                hdr += wxString::Format("  ·  %.0f°C", *unit.temp);
            if (!snap.mode.empty())
                hdr += "  ·  mode " + wxString::FromUTF8(snap.mode.c_str());
            s->Add(label(m_body, hdr, 1, true), 0, wxLEFT | wxTOP, FromDIP(8));
            s->Add(new wxStaticLine(m_body), 0, wxEXPAND | wxALL, FromDIP(6));

            wxBoxSizer* row = new wxBoxSizer(wxHORIZONTAL);
            // Always render four slots in order.
            for (int i = 0; i < 4; ++i) {
                Slic3r::AceMmu::AceSlot slot;
                slot.idx      = i;
                slot.occupied = false;
                for (const auto& sl : unit.slots)
                    if (sl.idx == i)
                        slot = sl;
                row->Add(make_slot_card(m_body, slot), 0, wxALL, FromDIP(6));
            }
            s->Add(row, 0, wxLEFT | wxRIGHT | wxBOTTOM, FromDIP(2));
        }

        if (!snap.toolheads.empty()) {
            s->Add(label(m_body, "Toolheads", 0, true), 0, wxLEFT | wxTOP, FromDIP(8));
            s->Add(new wxStaticLine(m_body), 0, wxEXPAND | wxALL, FromDIP(6));
            wxBoxSizer* hrow = new wxBoxSizer(wxHORIZONTAL);
            for (const auto& th : snap.toolheads) {
                wxPanel* hp = new wxPanel(m_body);
                hp->SetBackgroundColour(th.idx == snap.ace_head ? kAccent : card_bg());
                wxBoxSizer* hs = new wxBoxSizer(wxHORIZONTAL);
                wxPanel*    sw = new wxPanel(hp);
                sw->SetMinSize(hp->FromDIP(wxSize(14, 14)));
                wxColour c = th.color_rrggbb.empty() ? wxColour(120, 120, 120) : wxColour(wxString::FromUTF8(th.color_rrggbb.c_str()));
                sw->SetBackgroundColour(c.IsOk() ? c : wxColour(120, 120, 120));
                hs->Add(sw, 0, wxALIGN_CENTER_VERTICAL | wxALL, hp->FromDIP(6));
                hs->Add(label(hp, wxString::Format("T%d  %s", th.idx + 1, head_material(th))), 0, wxALIGN_CENTER_VERTICAL | wxRIGHT,
                        hp->FromDIP(8));
                hp->SetSizer(hs);
                hrow->Add(hp, 0, wxALL, FromDIP(4));
            }
            s->Add(hrow, 0, wxLEFT | wxRIGHT | wxBOTTOM, FromDIP(2));
        }
    }

    m_body->SetSizer(s, /*deleteOld*/ true);
    Layout();
    Fit();
    CentreOnParent();
    Thaw();
    Refresh();
}

}} // namespace Slic3r::GUI
