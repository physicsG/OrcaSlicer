#include "AcePlanDialog.hpp"

#include <algorithm>

#include <boost/algorithm/string/predicate.hpp>
#include <boost/filesystem/path.hpp>
#include <boost/log/trivial.hpp>
#include <wx/sizer.h>

#include "nlohmann/json.hpp"

#include "GUI_App.hpp"
#include "I18N.hpp"
#include "Widgets/WebView.hpp"
#include "libslic3r/Print.hpp"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/Utils.hpp"

namespace Slic3r { namespace GUI {

bool AcePlanDialog::worth_showing(const Print &print)
{
    // No ACE-fed head means a plain toolchanger: every filament already has its own head
    // and there is nothing to assign. A single filament has nothing to swap either.
    const std::vector<int> &caps = print.config().ace_head_capacity.values;
    if (std::none_of(caps.begin(), caps.end(), [](int c) { return c > 1; }))
        return false;
    return print.ace_sequence().size() > 1;
}

AcePlanDialog::AcePlanDialog(wxWindow *parent, const Print &print)
    : DPIDialog(parent, wxID_ANY, _L("Filament assignment"), wxDefaultPosition, wxDefaultSize,
                wxDEFAULT_DIALOG_STYLE | wxRESIZE_BORDER)
    , m_print(print)
{
    // WebKit needs a scheme: a bare filesystem path renders as "The URL can't be shown".
    // Same pattern as AceMmuPanel and WebGuideDialog.
    const wxString url = wxString("file://") +
                         from_u8((boost::filesystem::path(resources_dir()) / "web/aceplan/index.html")
                                     .make_preferred()
                                     .string());
    m_browser = WebView::CreateWebView(this, url);
    if (m_browser == nullptr) {
        BOOST_LOG_TRIVIAL(error) << "AcePlanDialog: no webview available";
        EndModal(wxID_CANCEL);
        return;
    }

    auto *sizer = new wxBoxSizer(wxVERTICAL);
    sizer->Add(m_browser, 1, wxEXPAND);
    SetSizer(sizer);
    SetSize(wxSize(FromDIP(1040), FromDIP(760)));
    CenterOnParent();

    Bind(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, &AcePlanDialog::on_script_message, this, m_browser->GetId());
    // The page replaces its demo state as soon as this arrives; pushing before the document
    // is loaded would run the script against nothing.
    Bind(wxEVT_WEBVIEW_LOADED, [this](wxWebViewEvent &) { push_state(); }, m_browser->GetId());
}

void AcePlanDialog::push_state()
{
    const std::string json = build_state_json();
    WebView::RunScript(m_browser, "window.setPlanState(" + json + ")");
}

std::string AcePlanDialog::build_state_json() const
{
    const PrintConfig &cfg  = m_print.config();
    const auto &       plan = m_print.ace_plan();

    nlohmann::json st;

    // Filaments: the page shows a spool per used colour, so it needs the project colours
    // and enough of the material to warn about mixing.
    const PresetBundle *bundle = wxGetApp().preset_bundle;
    const auto *colours = bundle ? bundle->project_config.option<ConfigOptionStrings>("filament_colour") : nullptr;
    const size_t n_filaments = cfg.filament_diameter.values.size();
    st["filaments"] = nlohmann::json::array();
    for (size_t f = 0; f < n_filaments; ++f) {
        nlohmann::json j;
        // The readable name is the chosen filament preset, which lives on the bundle -
        // PrintConfig only carries the physical properties.
        const bool has_preset = bundle && f < bundle->filament_presets.size() && !bundle->filament_presets[f].empty();
        j["name"] = has_preset ? bundle->filament_presets[f] : ("Filament " + std::to_string(f + 1));
        j["hex"]  = (colours && f < colours->values.size()) ? colours->values[f] : std::string("#cccccc");
        j["mat"]  = f < cfg.filament_type.values.size() ? cfg.filament_type.values[f] : std::string();
        st["filaments"].push_back(j);
    }

    st["capacities"] = cfg.ace_head_capacity.values;
    // "None" is -1 here as well: a stock feeder is addressed by no ACE.
    std::vector<int> units;
    units.reserve(cfg.ace_head_unit.values.size());
    for (size_t h = 0; h < cfg.ace_head_unit.values.size(); ++h) {
        const int cap = h < cfg.ace_head_capacity.values.size() ? cfg.ace_head_capacity.values[h] : 1;
        units.push_back(cap > 1 ? std::max(0, cfg.ace_head_unit.values[h]) : -1);
    }
    st["units"]    = units;
    st["sequence"] = m_print.ace_sequence();
    st["mode"]     = "auto";

    // Seed the page with the computed layout as pins so it opens on the plan that the
    // gcode would otherwise use, rather than on an empty board.
    st["pins"] = nlohmann::json::array();
    for (size_t f = 0; f < plan.head_of.size(); ++f) {
        if (plan.head_of[f] < 0)
            continue;
        nlohmann::json p;
        p["filament"] = int(f);
        p["head"]     = plan.head_of[f];
        p["slot"]     = f < plan.slot_of.size() ? plan.slot_of[f] : -1;
        st["pins"].push_back(p);
    }

    return st.dump();
}

AceMmu::LoadingPlan AcePlanDialog::as_plan(size_t n_filaments) const
{
    AceMmu::LoadingPlan plan;
    if (!m_result.applied)
        return plan;   // feasible stays false: an unapplied result must never reach gcode

    // -1 is the contract for "not placed" throughout the planner, so start there and only
    // fill in what the user actually assigned.
    plan.head_of.assign(n_filaments, -1);
    plan.slot_of.assign(n_filaments, -1);
    for (const Assignment &a : m_result.assign) {
        if (a.filament < 0 || size_t(a.filament) >= n_filaments)
            continue;
        plan.head_of[a.filament] = a.head;
        plan.slot_of[a.filament] = a.slot;
    }
    plan.feasible = std::none_of(plan.head_of.begin(), plan.head_of.end(), [](int h) { return h < 0; });
    // A hand-made layout carries no optimality claim, and the page priced it against the
    // same sequence the planner used.
    plan.optimal = !m_result.manual && m_result.swaps >= 0;
    plan.swaps   = m_result.swaps;
    return plan;
}

void AcePlanDialog::on_script_message(wxWebViewEvent &evt)
{
    const std::string msg = into_u8(evt.GetString());
    if (!boost::starts_with(msg, "apply:"))
        return;

    try {
        const nlohmann::json j = nlohmann::json::parse(msg.substr(6));
        m_result.applied = true;
        m_result.manual  = j.value("mode", std::string("auto")) == "manual";
        m_result.swaps   = j.value("swaps", -1);
        for (const auto &a : j.value("assign", nlohmann::json::array())) {
            Assignment as;
            as.filament = a.value("filament", -1);
            as.head     = a.value("head", -1);
            as.slot     = a.value("slot", -1);
            as.unit     = a.value("unit", -1);
            as.pinned   = a.value("pinned", false);
            m_result.assign.push_back(as);
        }
    } catch (const std::exception &e) {
        // A malformed message must not close the dialog as if the user had applied
        // something: silently accepting it would produce gcode for a layout nobody chose.
        BOOST_LOG_TRIVIAL(error) << "AcePlanDialog: bad apply message: " << e.what();
        m_result = Result{};
        return;
    }
    EndModal(wxID_OK);
}

}} // namespace Slic3r::GUI
