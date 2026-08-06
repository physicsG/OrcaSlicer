#ifndef slic3r_GUI_AceMmuDialog_hpp_
#define slic3r_GUI_AceMmuDialog_hpp_

#include <wx/dialog.h>

namespace Slic3r {
class MachineObject;
namespace GUI {

// Popup wrapper around AceMmuPanel (the native ACE MMU view). The same panel is
// also used as a top-level "MMU" tab; this dialog is the on-demand popup from
// Prepare. See docs/ace-mmu/device-page-mockup.html.
class AceMmuDialog : public wxDialog
{
public:
    AceMmuDialog(wxWindow* parent, MachineObject* obj);
};

} // namespace GUI
} // namespace Slic3r

#endif // slic3r_GUI_AceMmuDialog_hpp_
