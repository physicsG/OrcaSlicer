#ifndef slic3r_GUI_AceMmuDialog_hpp_
#define slic3r_GUI_AceMmuDialog_hpp_

#include <wx/dialog.h>

namespace Slic3r {
class MachineObject;
namespace GUI {

// A simple native "ACE MMU" page for the Snapmaker U1: an ACE-unit header
// (humidity / temperature) over a row of four slot cards, populated from
// MachineObject::amsList. First-cut of the Device-page design in
// docs/ace-mmu/device-page-mockup.html — display only, no controls yet.
class AceMmuDialog : public wxDialog
{
public:
    AceMmuDialog(wxWindow* parent, MachineObject* obj);

private:
    void           rebuild(); // (re)fetch the inventory and lay out the page
    MachineObject* m_obj  = nullptr;
    class wxPanel* m_body = nullptr;
};

} // namespace GUI
} // namespace Slic3r

#endif // slic3r_GUI_AceMmuDialog_hpp_
