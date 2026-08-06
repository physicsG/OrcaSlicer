#ifndef slic3r_GUI_AceMmuPanel_hpp_
#define slic3r_GUI_AceMmuPanel_hpp_

#include <wx/panel.h>
#include <wx/string.h>
#include <string>

class wxWebView;

namespace Slic3r {
class MachineObject;
namespace GUI {

// Native "U1 + multiACE" page. Rendered as a wxWebView loading
// resources/web/multiace/index.html (the same design iterated in
// docs/ace-mmu/u1-multiace-page.html) — the Flutter-like path Snapmaker uses.
// C++ fetches the live AceSnapshot, serialises it to JSON, and injects it via
// window.setAceState(...). Resolves the printer host itself, so it works both as
// a top-level tab and inside a dialog.
class AceMmuPanel : public wxPanel
{
public:
    explicit AceMmuPanel(wxWindow* parent, MachineObject* obj = nullptr);
    void refresh(); // re-fetch the inventory and push it to the page

private:
    void        push_state();       // fetch snapshot -> inject (or cache until loaded)
    std::string build_state_json(); // serialise the current snapshot for the page
    void        send_gcode(const std::string& script); // via the Klipper connection

    MachineObject* m_obj    = nullptr; // optional: keep its amsList in sync
    wxWebView*     m_web    = nullptr;
    bool           m_loaded = false;
    wxString       m_pending;          // last JSON, injected once the page is loaded
};

} // namespace GUI
} // namespace Slic3r

#endif // slic3r_GUI_AceMmuPanel_hpp_
