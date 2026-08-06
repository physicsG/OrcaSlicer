#include "AceMmuDialog.hpp"
#include "AceMmuPanel.hpp"

#include <wx/sizer.h>
#include <wx/button.h>

namespace Slic3r { namespace GUI {

AceMmuDialog::AceMmuDialog(wxWindow* parent, MachineObject* obj)
    : wxDialog(parent, wxID_ANY, "ACE MMU", wxDefaultPosition, wxDefaultSize, wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER)
{
    wxBoxSizer* top = new wxBoxSizer(wxVERTICAL);
    top->Add(new AceMmuPanel(this, obj), 1, wxEXPAND);

    wxButton* close = new wxButton(this, wxID_OK, "Close");
    top->Add(close, 0, wxALIGN_RIGHT | wxALL, FromDIP(12));

    SetSizerAndFit(top);
    SetMinSize(FromDIP(wxSize(600, 440)));
    CentreOnParent();
}

}} // namespace Slic3r::GUI
