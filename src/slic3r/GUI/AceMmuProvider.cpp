#include "AceMmuProvider.hpp"

#include "slic3r/Utils/Http.hpp"
#include "slic3r/Utils/PrintHost.hpp"
#include "GUI_App.hpp"
#include "DeviceManager.hpp"
#include "libslic3r/PresetBundle.hpp"

#include "nlohmann/json.hpp"
#include <boost/log/trivial.hpp>
#include <boost/algorithm/string/predicate.hpp>

#include <chrono>
#include <memory>
#include <utility>

namespace Slic3r { namespace GUI {

// "http://192.168.2.242:7125/" / "192.168.2.242:7125" -> "192.168.2.242".
static std::string host_to_ip(std::string h)
{
    const auto scheme = h.find("://");
    if (scheme != std::string::npos)
        h = h.substr(scheme + 3);
    h = h.substr(0, h.find('/')); // strip any path
    h = h.substr(0, h.find(':')); // strip any port
    while (!h.empty() && (h.back() == ' ' || h.back() == '\t'))
        h.pop_back();
    return h;
}

std::string AceMmuProvider::resolve_connected_host()
{
    // 1) Selected MachineObject's IP (Bambu-style path).
    if (auto* dev = wxGetApp().getDeviceManager()) {
        if (MachineObject* obj = dev->get_selected_machine())
            if (!obj->dev_ip.empty()) {
                BOOST_LOG_TRIVIAL(info) << "AceMmuProvider::resolve_connected_host: dev_ip=" << obj->dev_ip;
                return obj->dev_ip;
            }
    }

    // 2) The connected PrintHost (set by SSWCP when the U1 connects).
    std::shared_ptr<PrintHost> host;
    wxGetApp().get_connect_host(host);
    if (host) {
        const std::string ip = host_to_ip(host->get_host());
        if (!ip.empty()) {
            BOOST_LOG_TRIVIAL(info) << "AceMmuProvider::resolve_connected_host: connect_host=" << ip;
            return ip;
        }
    }

    // 3) The host config SSWCP stores on connect (this is where print_host actually
    //    lands for the U1 — it is set on a copy, not the edited preset).
    if (DynamicPrintConfig* hc = wxGetApp().get_host_config()) {
        if (hc->has("print_host")) {
            const std::string ip = host_to_ip(hc->opt_string("print_host"));
            if (!ip.empty()) {
                BOOST_LOG_TRIVIAL(info) << "AceMmuProvider::resolve_connected_host: host_config print_host=" << ip;
                return ip;
            }
        }
    }

    // 4) Last resort: the edited printer preset's print_host, if any.
    if (wxGetApp().preset_bundle) {
        const auto& cfg = wxGetApp().preset_bundle->printers.get_edited_preset().config;
        if (cfg.has("print_host")) {
            const std::string ip = host_to_ip(cfg.opt_string("print_host"));
            if (!ip.empty()) {
                BOOST_LOG_TRIVIAL(info) << "AceMmuProvider::resolve_connected_host: preset print_host=" << ip;
                return ip;
            }
        }
    }

    BOOST_LOG_TRIVIAL(warning) << "AceMmuProvider::resolve_connected_host: no host found (dev_ip/connect_host/print_host all empty)";
    return {};
}

std::string AceMmuProvider::resolve_generic_filament_id(const std::string& material)
{
    if (material.empty() || !wxGetApp().preset_bundle)
        return {};
    // Mirror PresetBundle::sync_ams_list's own fallback: a compatible, system
    // "Generic <material>" preset. Returning its filament_id lets the direct match
    // in sync_ams_list succeed, so the spool isn't counted as "unknown".
    const std::string want      = "Generic " + material;
    const auto&       filaments = wxGetApp().preset_bundle->filaments;
    for (auto it = filaments.begin(); it != filaments.end(); ++it) {
        if (it->is_compatible && it->is_system && boost::algorithm::starts_with(it->name, want))
            return it->filament_id;
    }
    return {};
}

AceMmuProvider::AceMmuProvider(std::string host, int poll_interval_s)
    : m_host(std::move(host)), m_base_url("http://" + m_host + "/multiace"), m_poll_interval_s(poll_interval_s < 1 ? 1 : poll_interval_s)
{}

AceMmuProvider::~AceMmuProvider() { stop(); }

void AceMmuProvider::start()
{
    if (m_running.exchange(true))
        return; // already running
    m_worker = std::thread(&AceMmuProvider::run, this);
}

void AceMmuProvider::stop()
{
    if (!m_running.exchange(false))
        return; // already stopped
    m_wait_cv.notify_all();
    if (m_worker.joinable())
        m_worker.join();
}

AceMmu::AceSnapshot AceMmuProvider::snapshot() const
{
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_snapshot;
}

bool AceMmuProvider::fetch_once(int timeout_connect_s, int timeout_max_s)
{
    const std::string url = m_base_url + "/api/state";

    bool                well_formed = false;
    AceMmu::AceSnapshot parsed;

    Http::get(url)
        .timeout_connect(timeout_connect_s)
        .timeout_max(timeout_max_s)
        .on_error([&](std::string /*body*/, std::string error, unsigned status) {
            BOOST_LOG_TRIVIAL(warning) << "AceMmuProvider: GET " << url << " failed: " << error << " (status " << status << ")";
        })
        .on_complete([&](std::string body, unsigned /*status*/) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, /*allow_exceptions=*/false);
            if (!doc.is_object()) {
                BOOST_LOG_TRIVIAL(warning) << "AceMmuProvider: " << url << " returned a non-object body; keeping last good snapshot";
                return;
            }
            parsed      = AceMmu::parse_ace_state(doc);
            well_formed = true;
        })
        .perform_sync();

    if (!well_formed)
        return false; // transient/failed/garbage: keep last good

    const int device_count = parsed.device_count;
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_snapshot = std::move(parsed);
    }
    const uint64_t rev = m_revision.fetch_add(1) + 1;
    BOOST_LOG_TRIVIAL(debug) << "AceMmuProvider: refreshed; device_count=" << device_count << " rev=" << rev;
    return true;
}

void AceMmuProvider::run()
{
    while (m_running.load()) {
        fetch_once();

        std::unique_lock<std::mutex> lock(m_wait_mutex);
        m_wait_cv.wait_for(lock, std::chrono::seconds(m_poll_interval_s), [this] { return !m_running.load(); });
    }
}

}} // namespace Slic3r::GUI
