#ifndef slic3r_GUI_AcePlanDialog_hpp_
#define slic3r_GUI_AcePlanDialog_hpp_

#include <string>
#include <vector>

#include <wx/webview.h>

#include "GUI_Utils.hpp"
#include "libslic3r/AceMmuPlan.hpp"
#include "libslic3r/AceMmuReconcile.hpp"
#include "libslic3r/AceMmuState.hpp"

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
        bool                    forced  = false;   // printed despite unresolved ACE slots
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

    // True when the printer answered and its slots could be compared at all. The ACE is
    // LAN-only, so a cloud-connected machine simply cannot be read - and "could not check"
    // must never be allowed to look like "checked and fine".
    bool ace_checked() const { return !m_ace.units.empty(); }

    // ACE slots that a given layout leaves unconfirmed - wrong spool, empty, or a spool the
    // machine cannot identify. Judged against the snapshot read when the dialog opened, and
    // against the layout the user is actually committing, since moving a spool in the board
    // can resolve a mismatch. 0 when nothing was read.
    size_t unresolved_for(const AceMmu::LoadingPlan &plan) const;

protected:
    void on_dpi_changed(const wxRect &suggested_rect) override {}

private:
    void        on_script_message(wxWebViewEvent &evt);
    void        push_state();
    std::string build_state_json() const;
    // Per head, the ACE unit feeding it (-1 = stock feeder). Shared by the page payload and
    // the reconciliation, so the two can never disagree about the machine's wiring.
    std::vector<int> head_units() const;

    wxWebView   *m_browser = nullptr;
    const Print &m_print;
    Result       m_result;
    // Read once, when the dialog opens. A live poll would let the board's verdicts change
    // under the user mid-decision.
    AceMmu::AceSnapshot m_ace;
};

}} // namespace Slic3r::GUI

#endif
