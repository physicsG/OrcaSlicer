#ifndef slic3r_GUI_AcePlanDialog_hpp_
#define slic3r_GUI_AcePlanDialog_hpp_

#include <string>
#include <vector>

#include <wx/webview.h>

#include "GUI_Utils.hpp"
#include "libslic3r/AceMmuPlan.hpp"

namespace Slic3r {

class Print;

namespace GUI {

// Host for resources/web/aceplan/index.html - the filament assignment page.
//
// The page owns the interaction (drag to pin, auto/manual, swap cost); this class owns
// the data contract with it: push state in, read one "apply" message back. Everything the
// page needs is pushed once, so it never reaches back into the app.
class AcePlanDialog : public DPIDialog
{
public:
    // One filament's assignment as the user left it.
    struct Assignment
    {
        int  filament = -1;
        int  head     = -1;   // -1 when the plan could not place it
        int  slot     = -1;
        int  unit     = -1;   // ACE unit feeding that head, -1 for a stock feeder
        bool pinned   = false;
    };

    struct Result
    {
        bool                    applied = false;
        bool                    manual  = false;   // user overrode the computed layout
        int                     swaps   = -1;      // as priced by the page
        std::vector<Assignment> assign;
    };

    AcePlanDialog(wxWindow *parent, const Print &print);
    ~AcePlanDialog() override = default;

    const Result &result() const { return m_result; }

    // The applied assignment as a plan the Print can consume. Only meaningful once the
    // user has applied; returns an infeasible plan otherwise, which callers must not use.
    AceMmu::LoadingPlan as_plan(size_t n_filaments) const;

    // Whether a plate is worth showing this for at all: an ACE-fed head and something to
    // place on it. Callers use this to decide, so the dialog never opens with nothing to say.
    static bool worth_showing(const Print &print);

protected:
    void on_dpi_changed(const wxRect &suggested_rect) override {}

private:
    void        on_script_message(wxWebViewEvent &evt);
    void        push_state();
    std::string build_state_json() const;

    wxWebView   *m_browser = nullptr;
    const Print &m_print;
    Result       m_result;
};

}} // namespace Slic3r::GUI

#endif
