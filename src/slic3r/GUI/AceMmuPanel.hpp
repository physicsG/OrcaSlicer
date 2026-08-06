#ifndef slic3r_GUI_AceMmuPanel_hpp_
#define slic3r_GUI_AceMmuPanel_hpp_

#include <wx/panel.h>
#include <wx/string.h>
#include <wx/timer.h>
#include <atomic>
#include <memory>
#include <string>

class wxWebView;

namespace Slic3r {
class MachineObject;
namespace GUI {

// Native "U1 + multiACE" page. Rendered as a wxWebView loading
// resources/web/multiace/index.html (the same design iterated in
// docs/ace-mmu/u1-multiace-page.html) — the Flutter-like path Snapmaker uses.
// C++ fetches the live AceSnapshot + Moonraker machine state, serialises them to
// JSON and injects via window.setAceState(...). Page controls (dryer, ...) post
// "gcode:<script>" which is forwarded through the Klipper connection. Fetches run
// on a worker thread; a timer polls while the tab is visible.
class AceMmuPanel : public wxPanel
{
public:
    explicit AceMmuPanel(wxWindow* parent, MachineObject* obj = nullptr);
    ~AceMmuPanel() override;
    void refresh(); // re-fetch the inventory and push it to the page

private:
    void push_state();                                 // fetch (worker) -> inject
    void send_gcode(const std::string& script);        // via the Klipper connection

    MachineObject* m_obj    = nullptr; // optional: keep its amsList in sync
    wxWebView*     m_web    = nullptr;
    bool           m_loaded = false;
    wxString       m_pending;                           // last JSON, injected once loaded
    wxTimer        m_poll;                              // live-update timer
    std::atomic<bool> m_fetching{false};                // one fetch in flight
    // set false in the destructor so a pending worker's CallAfter is a no-op
    std::shared_ptr<std::atomic<bool>> m_alive = std::make_shared<std::atomic<bool>>(true);
};

} // namespace GUI
} // namespace Slic3r

#endif // slic3r_GUI_AceMmuPanel_hpp_
