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

    /*
     * 4) A saved device record.
     *
     * This is where a U1's address actually lives, and none of the three above has it at
     * SLICING time: the webview brings the transport up when the Device tab or the print
     * popup opens, so at the moment the gcode is written there is no selected machine, no
     * connected PrintHost and no host config - measured, by a plate that planned as though
     * the ACE were empty while the popup a second later showed its three spools.
     *
     * Preferring a record marked connected, then any with an address. It is only ever used
     * to ASK the printer what it is holding, and a wrong guess costs a failed HTTP call.
     */
    if (auto* cfg = wxGetApp().app_config) {
        const std::vector<DeviceInfo> devices = cfg->get_devices();
        for (bool want_connected : {true, false})
            for (const DeviceInfo& d : devices)
                if (!d.ip.empty() && d.connected == want_connected) {
                    BOOST_LOG_TRIVIAL(info) << "AceMmuProvider::resolve_connected_host: saved device "
                                            << d.dev_name << " ip=" << d.ip;
                    return d.ip;
                }
    }

    // 5) Last resort: the edited printer preset's print_host, if any.
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

/*
 * `print_task_config` over Moonraker, which is the only place a stock feeder's contents are
 * reported. Port 7125 and no authentication, the same door `u1_bridge.py` and the Device
 * page's own reads use.
 */
std::map<int, AceMmuProvider::FeederSpool> AceMmuProvider::fetch_feeders(const std::string& host,
                                                                        int timeout_connect_s,
                                                                        int timeout_max_s)
{
    std::map<int, FeederSpool> out;
    if (host.empty())
        return out;
    const std::string url = "http://" + host + ":7125/printer/objects/query?print_task_config";

    Http::get(url)
        .timeout_connect(timeout_connect_s)
        .timeout_max(timeout_max_s)
        .on_error([&](std::string, std::string error, unsigned status) {
            BOOST_LOG_TRIVIAL(warning) << "AceMmuProvider::fetch_feeders: " << url << " failed: " << error
                                       << " (status " << status << ")";
        })
        .on_complete([&](std::string body, unsigned) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, false);
            if (!doc.is_object())
                return;
            const auto tc = doc.value("result", nlohmann::json::object())
                               .value("status", nlohmann::json::object())
                               .value("print_task_config", nlohmann::json::object());
            const auto types  = tc.value("filament_type", nlohmann::json::array());
            const auto rgba   = tc.value("filament_color_rgba", nlohmann::json::array());
            const auto exists = tc.value("filament_exist", nlohmann::json::array());
            for (size_t i = 0; i < types.size(); ++i) {
                // `filament_exist` is the machine's own answer about whether anything is
                // there; a head it says is empty must not become a place to plan onto.
                if (i < exists.size() && exists[i].is_boolean() && !exists[i].get<bool>())
                    continue;
                FeederSpool spool;
                if (types[i].is_string())
                    spool.material = types[i].get<std::string>();
                if (i < rgba.size() && rgba[i].is_string())
                    spool.colour_rgba = rgba[i].get<std::string>();
                if (spool.material.empty() && spool.colour_rgba.empty())
                    continue;   // nothing asserted about this head
                out[int(i)] = spool;
            }
        })
        .perform_sync();
    return out;
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
