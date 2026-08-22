#ifndef slic3r_GUI_AceAssignPopup_hpp_
#define slic3r_GUI_AceAssignPopup_hpp_

// Which ACE feeds one toolhead.
//
// A choice, not a count. The firmware offers exactly two macros for this -
//
//     ACE_SET_HEAD_FEEDER  HEAD=0..3 ENABLE=0|1   (head mode only)
//     ACE_SET_HEAD_ACE     HEAD=0..3 ACE=0..3     "wired to exactly one ACE"
//
// - so the list has exactly two kinds of row and a tick, rather than the slot spinner the
// Multimaterial page offers. Between them the rows write exactly `ace_head_unit` and
// `ace_head_capacity`. See docs/ace-mmu/15-printer-panel.md.
//
// One unit may feed several heads: ACE_SET_HEAD_ACE binds a head to a unit and says nothing about
// the reverse. Ticking a unit already feeding another head is therefore legal, the row says so,
// and the panel states what the shared capacity really is.

#include "Widgets/PopupWindow.hpp"
#include "libslic3r/AceMmuState.hpp"

#include <functional>
#include <vector>

namespace Slic3r { namespace GUI {

class AceAssignPopup : public PopupWindow
{
public:
    // `snap_valid` is false until Sync info has read the machine. The popover still works then -
    // the preset is what lets slicing run with the printer switched off - but the rows carry no
    // live detail and the list falls back to the four units `ace_head_unit` accepts.
    AceAssignPopup(wxWindow                  *parent,
                   size_t                     head_idx,
                   const std::vector<int>    &head_unit,
                   const std::vector<int>    &head_cap,
                   const AceMmu::AceSnapshot &snap,
                   bool                       snap_valid);

    // (unit, capacity) as the preset stores them: unit -1 with capacity 1 is the stock feeder.
    void on_choice(std::function<void(int unit, int cap)> cb) { m_choice = std::move(cb); }

    void popup_at(wxWindow *anchor);

    // wxPopupTransientWindow does not own itself; the picker in filamentsync/ sets the precedent.
    void OnDismiss() override;

private:
    void add_row(wxWindow *parent, wxSizer *sizer, int unit, int cap, const wxString &title,
                 const wxString &detail, bool ticked, const AceMmu::AceUnit *live);

    std::function<void(int unit, int cap)> m_choice;
    size_t                                 m_head_idx = 0;
};

}} // namespace Slic3r::GUI

#endif // slic3r_GUI_AceAssignPopup_hpp_
