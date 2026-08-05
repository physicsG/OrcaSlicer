#include "AceMmuProvider.hpp"

#include "slic3r/Utils/Http.hpp"
#include "slic3r/Utils/PrintHost.hpp"
#include "GUI_App.hpp"
#include "DeviceManager.hpp"

#include "nlohmann/json.hpp"
#include <boost/log/trivial.hpp>

#include <chrono>
#include <memory>
#include <utility>

namespace Slic3r { namespace GUI {

std::string AceMmuProvider::resolve_connected_host()
{
    // Prefer a selected MachineObject's IP.
    if (auto* dev = wxGetApp().getDeviceManager()) {
        if (MachineObject* obj = dev->get_selected_machine())
            if (!obj->dev_ip.empty())
                return obj->dev_ip;
    }
    // Fall back to the connected PrintHost (the U1's webview connection).
    std::shared_ptr<PrintHost> host;
    wxGetApp().get_connect_host(host);
    if (host) {
        std::string h      = host->get_host();
        const auto  scheme = h.find("://");
        if (scheme != std::string::npos)
            h = h.substr(scheme + 3);
        h = h.substr(0, h.find('/')); // strip any path
        h = h.substr(0, h.find(':')); // strip any port
        return h;
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

bool AceMmuProvider::fetch_once()
{
    const std::string url = m_base_url + "/api/state";

    bool                well_formed = false;
    AceMmu::AceSnapshot parsed;

    Http::get(url)
        .timeout_connect(4)
        .timeout_max(8)
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
