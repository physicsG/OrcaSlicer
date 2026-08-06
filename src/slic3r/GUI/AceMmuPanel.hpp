#ifndef slic3r_GUI_AceMmuPanel_hpp_
#define slic3r_GUI_AceMmuPanel_hpp_

#include <wx/panel.h>

namespace Slic3r {
class MachineObject;
namespace GUI {

// Native ACE MMU view: an ACE-unit header (humidity/temp/protocol/mode) over four
// slot cards (colour, material, brand, RFID/override chip, hex) and a toolhead
// strip, with a Refresh button. Resolves the printer host itself (works with no
// MachineObject), so it can be used both as a top-level tab and inside a dialog.
// Modelled on docs/ace-mmu/device-page-mockup.html. Display only for now.
class AceMmuPanel : public wxPanel
{
public:
    explicit AceMmuPanel(wxWindow* parent, MachineObject* obj = nullptr);
    void refresh(); // re-fetch the inventory and rebuild

private:
    void rebuild();

    MachineObject* m_obj  = nullptr; // optional: keep its amsList in sync
    wxPanel*       m_body = nullptr;
};

} // namespace GUI
} // namespace Slic3r

#endif // slic3r_GUI_AceMmuPanel_hpp_
