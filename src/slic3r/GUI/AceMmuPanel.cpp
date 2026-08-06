#include "AceMmuPanel.hpp"
#include "DeviceManager.hpp"
#include "AceMmuProvider.hpp"
#include "libslic3r/AceMmuState.hpp"

#include <wx/sizer.h>
#include <wx/wrapsizer.h>
#include <wx/stattext.h>
#include <wx/statline.h>
#include <wx/panel.h>
#include <wx/button.h>
#include <wx/settings.h>
#include <wx/font.h>
#include <boost/log/trivial.hpp>

namespace Slic3r { namespace GUI {

namespace {

const wxColour kAccent(23, 184, 144);
const wxColour kWarn(214, 152, 60);

wxColour dim_text() { return wxSystemSettings::GetColour(wxSYS_COLOUR_GRAYTEXT); }
wxColour card_bg() { return wxSystemSettings::GetColour(wxSYS_COLOUR_BTNFACE); }
wxColour panel_bg() { return wxSystemSettings::GetColour(wxSYS_COLOUR_WINDOW); }

const wxColour& dim_text_ref()
{
    static wxColour c = dim_text();
    return c;
}

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

wxStaticText* chip(wxWindow* p, const wxString& text, const wxColour& col) { return label(p, text, -1, true, &col); }

// multiACE protocol -> ACE model name ("" unknown, v1 = ACE Pro, v2 = ACE 2 Pro).
wxString ace_model_name(const std::string& protocol)
{
    if (protocol == "v2")
        return "ACE 2 Pro";
    if (protocol == "v1")
        return "ACE Pro";
    return "ACE";
}

wxString head_material(const Slic3r::AceMmu::AceToolhead& t)
{
    if (!t.material.empty())
        return wxString::FromUTF8(t.material.c_str());
    return t.filament_detected ? wxString("Loaded") : wxString("Empty");
}

// A titled card container (returns the card; its content sizer is on `out_sizer`).
wxPanel* make_card(wxWindow* parent, const wxString& title, wxBoxSizer*& out_sizer)
{
    wxPanel* card = new wxPanel(parent);
    card->SetBackgroundColour(card_bg());
    wxBoxSizer* v = new wxBoxSizer(wxVERTICAL);
    if (!title.empty())
        v->Add(label(card, title.Upper(), -1, true, &dim_text_ref()), 0, wxLEFT | wxRIGHT | wxTOP, card->FromDIP(12));
    out_sizer = new wxBoxSizer(wxVERTICAL);
    v->Add(out_sizer, 1, wxEXPAND | wxALL, card->FromDIP(12));
    card->SetSizer(v);
    return card;
}

// A small "key / value" metric tile.
wxPanel* make_metric(wxWindow* parent, const wxString& key, const wxString& value)
{
    wxPanel* tile = new wxPanel(parent);
    tile->SetBackgroundColour(panel_bg());
    tile->SetMinSize(parent->FromDIP(wxSize(120, 52)));
    wxBoxSizer* v = new wxBoxSizer(wxVERTICAL);
    v->Add(label(tile, key, -1, false, &dim_text_ref()), 0, wxLEFT | wxRIGHT | wxTOP, tile->FromDIP(8));
    v->Add(label(tile, value, 1, true), 0, wxLEFT | wxRIGHT | wxBOTTOM, tile->FromDIP(8));
    tile->SetSizer(v);
    return tile;
}

// One slot card: slot label, colour swatch, material, brand, identity chip + hex.
wxPanel* make_slot_card(wxWindow* parent, const Slic3r::AceMmu::AceSlot& slot)
{
    wxPanel* card = new wxPanel(parent);
    card->SetMinSize(parent->FromDIP(wxSize(132, 172)));
    card->SetBackgroundColour(panel_bg());

    wxBoxSizer* s = new wxBoxSizer(wxVERTICAL);
    s->Add(label(card, wxString::Format("Slot %d", slot.idx + 1), 0, true), 0, wxLEFT | wxTOP, card->FromDIP(8));

    wxPanel* swatch = new wxPanel(card);
    swatch->SetMinSize(card->FromDIP(wxSize(58, 58)));
    if (slot.occupied) {
        wxColour c = slot.color_rrggbb.empty() ? wxColour(150, 150, 150) : wxColour(wxString::FromUTF8(slot.color_rrggbb.c_str()));
        swatch->SetBackgroundColour(c.IsOk() ? c : wxColour(150, 150, 150));
    } else {
        swatch->SetBackgroundColour(card_bg());
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
        if (!slot.color_rrggbb.empty())
            foot->Add(label(card, wxString::FromUTF8(slot.color_rrggbb.c_str()).Upper(), -1, false, &dim_text_ref()), 0);
        s->Add(foot, 0, wxALIGN_CENTER | wxTOP, card->FromDIP(8));
    } else {
        s->Add(label(card, "Empty", 0, false, &dim_text_ref()), 0, wxALIGN_CENTER);
    }

    card->SetSizer(s);
    return card;
}

} // namespace

AceMmuPanel::AceMmuPanel(wxWindow* parent, MachineObject* obj) : wxPanel(parent, wxID_ANY), m_obj(obj)
{
    wxBoxSizer* top = new wxBoxSizer(wxVERTICAL);

    wxBoxSizer* headbar = new wxBoxSizer(wxHORIZONTAL);
    headbar->Add(label(this, "Snapmaker U1 · ACE MMU", 3, true), 0, wxALIGN_CENTER_VERTICAL);
    headbar->Add(chip(this, "  ● LAN  ", kAccent), 0, wxALIGN_CENTER_VERTICAL | wxLEFT, FromDIP(10));
    headbar->AddStretchSpacer();
    wxButton* refresh_btn = new wxButton(this, wxID_ANY, "Refresh");
    refresh_btn->Bind(wxEVT_BUTTON, [this](wxCommandEvent&) { rebuild(); });
    headbar->Add(refresh_btn, 0, wxALIGN_CENTER_VERTICAL);
    top->Add(headbar, 0, wxEXPAND | wxALL, FromDIP(16));

    m_body = new wxPanel(this);
    top->Add(m_body, 1, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, FromDIP(12));

    SetSizer(top);
    rebuild();
}

void AceMmuPanel::refresh() { rebuild(); }

void AceMmuPanel::rebuild()
{
    Freeze();
    m_body->DestroyChildren();

    // Resolve the connected printer host and fetch a fresh snapshot.
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
    BOOST_LOG_TRIVIAL(info) << "AceMmuPanel: host='" << host << "' fetched=" << fetched << " units=" << snap.units.size();
    if (m_obj && !snap.units.empty())
        m_obj->apply_ace_snapshot(snap);

    wxBoxSizer* cols = new wxBoxSizer(wxHORIZONTAL);

    // ---- Left column: printer status ----
    wxBoxSizer* pbox  = nullptr;
    wxPanel*    pcard = make_card(m_body, "Printer", pbox);
    pcard->SetMinSize(m_body->FromDIP(wxSize(300, -1)));
    {
        wxPanel* cam = new wxPanel(pcard);
        cam->SetMinSize(pcard->FromDIP(wxSize(260, 150)));
        cam->SetBackgroundColour(wxColour(24, 28, 33));
        wxBoxSizer* cs = new wxBoxSizer(wxVERTICAL);
        cs->AddStretchSpacer();
        cs->Add(label(cam, "Camera preview", 0, false, &dim_text_ref()), 0, wxALIGN_CENTER);
        cs->AddStretchSpacer();
        cam->SetSizer(cs);
        pbox->Add(cam, 0, wxEXPAND | wxBOTTOM, m_body->FromDIP(10));

        wxWrapSizer* metrics = new wxWrapSizer(wxHORIZONTAL);
        metrics->Add(make_metric(pcard, "State",
                                 snap.printer_state.empty() ? wxString("—") : wxString::FromUTF8(snap.printer_state.c_str())),
                     0, wxALL, m_body->FromDIP(4));
        metrics->Add(make_metric(pcard, "Mode", snap.mode.empty() ? wxString("—") : wxString::FromUTF8(snap.mode.c_str())), 0, wxALL,
                     m_body->FromDIP(4));
        metrics->Add(make_metric(pcard, "ACE temp", snap.ace_temp ? wxString::Format("%.0f °C", *snap.ace_temp) : wxString("—")), 0, wxALL,
                     m_body->FromDIP(4));
        metrics->Add(make_metric(pcard, "Units", wxString::Format("%d", snap.device_count)), 0, wxALL, m_body->FromDIP(4));
        pbox->Add(metrics, 0, wxEXPAND);
    }
    cols->Add(pcard, 0, wxEXPAND | wxRIGHT, m_body->FromDIP(12));

    // ---- Right column: ACE inventory ----
    wxBoxSizer* abox  = nullptr;
    wxPanel*    acard = make_card(m_body, "", abox);

    if (snap.units.empty()) {
        abox->Add(label(acard, "No ACE unit detected.\nConnect the Snapmaker U1 over LAN and make sure multiACE is running.", 0, false,
                        &dim_text_ref()),
                  0, wxALL, m_body->FromDIP(8));
    } else {
        for (const auto& unit : snap.units) {
            wxBoxSizer* uh = new wxBoxSizer(wxHORIZONTAL);
            uh->Add(label(acard, ace_model_name(unit.protocol), 2, true), 0, wxALIGN_CENTER_VERTICAL);
            wxString meta = wxString::Format("Unit %c · ", char('A' + unit.idx));
            meta += unit.connected ? "connected" : "offline";
            uh->Add(label(acard, "   " + meta, -1, false, &dim_text_ref()), 0, wxALIGN_CENTER_VERTICAL);
            uh->AddStretchSpacer();
            if (unit.humidity)
                uh->Add(make_metric(acard, "Humidity", wxString::Format("%d%%", *unit.humidity)), 0, wxRIGHT, m_body->FromDIP(6));
            if (unit.temp)
                uh->Add(make_metric(acard, "Temp", wxString::Format("%.0f °C", *unit.temp)), 0, wxRIGHT, m_body->FromDIP(6));
            uh->Add(make_metric(acard, "Dryer",
                                unit.dryer_remaining_minutes && *unit.dryer_remaining_minutes > 0 ?
                                    wxString::Format("%d min", *unit.dryer_remaining_minutes) :
                                    wxString("Off")),
                    0);
            abox->Add(uh, 0, wxEXPAND | wxBOTTOM, m_body->FromDIP(8));
            abox->Add(new wxStaticLine(acard), 0, wxEXPAND | wxBOTTOM, m_body->FromDIP(8));

            wxBoxSizer* row = new wxBoxSizer(wxHORIZONTAL);
            for (int i = 0; i < 4; ++i) {
                Slic3r::AceMmu::AceSlot slot;
                slot.idx      = i;
                slot.occupied = false;
                for (const auto& sl : unit.slots)
                    if (sl.idx == i)
                        slot = sl;
                row->Add(make_slot_card(acard, slot), 0, wxRIGHT | wxBOTTOM, m_body->FromDIP(10));
            }
            abox->Add(row, 0);
        }

        if (!snap.toolheads.empty()) {
            abox->Add(label(acard, "TOOLHEADS", -1, true, &dim_text_ref()), 0, wxTOP | wxBOTTOM, m_body->FromDIP(6));
            wxBoxSizer* hrow = new wxBoxSizer(wxHORIZONTAL);
            for (const auto& th : snap.toolheads) {
                wxPanel* hp = new wxPanel(acard);
                hp->SetBackgroundColour(th.idx == snap.ace_head ? kAccent : panel_bg());
                wxBoxSizer* hs = new wxBoxSizer(wxHORIZONTAL);
                wxPanel*    sw = new wxPanel(hp);
                sw->SetMinSize(hp->FromDIP(wxSize(14, 14)));
                wxColour c = th.color_rrggbb.empty() ? wxColour(120, 120, 120) : wxColour(wxString::FromUTF8(th.color_rrggbb.c_str()));
                sw->SetBackgroundColour(c.IsOk() ? c : wxColour(120, 120, 120));
                hs->Add(sw, 0, wxALIGN_CENTER_VERTICAL | wxALL, hp->FromDIP(6));
                hs->Add(label(hp, wxString::Format("T%d  %s", th.idx + 1, head_material(th))), 0, wxALIGN_CENTER_VERTICAL | wxRIGHT,
                        hp->FromDIP(8));
                hp->SetSizer(hs);
                hrow->Add(hp, 0, wxRIGHT, m_body->FromDIP(8));
            }
            abox->Add(hrow, 0, wxBOTTOM, m_body->FromDIP(8));
        }

        // Legend
        wxBoxSizer* legend = new wxBoxSizer(wxHORIZONTAL);
        legend->Add(chip(acard, "RFID", kAccent), 0, wxRIGHT, m_body->FromDIP(4));
        legend->Add(label(acard, "trusted    ", -1, false, &dim_text_ref()), 0);
        legend->Add(chip(acard, "OVERRIDE", kWarn), 0, wxRIGHT, m_body->FromDIP(4));
        legend->Add(label(acard, "manual", -1, false, &dim_text_ref()), 0);
        abox->Add(legend, 0, wxTOP, m_body->FromDIP(4));
    }
    cols->Add(acard, 1, wxEXPAND);

    m_body->SetSizer(cols, /*deleteOld*/ true);
    Layout();
    Thaw();
    Refresh();
}

}} // namespace Slic3r::GUI
