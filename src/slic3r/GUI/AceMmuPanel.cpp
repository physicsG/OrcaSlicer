#include "AceMmuPanel.hpp"
#include "DeviceManager.hpp"
#include "AceMmuProvider.hpp"
#include "GUI_App.hpp"
#include "Widgets/WebView.hpp"
#include "libslic3r/AceMmuState.hpp"
#include "libslic3r/Utils.hpp"
#include "slic3r/Utils/PrintHost.hpp"
#include "slic3r/Utils/Http.hpp"

#include <wx/sizer.h>
#include <wx/webview.h>
#include <boost/filesystem.hpp>
#include <boost/log/trivial.hpp>
#include "nlohmann/json.hpp"
#include <thread>
#include <algorithm>

namespace Slic3r { namespace GUI {

namespace {
// file:// URL of the bundled page (same pattern as WebGuideDialog).
wxString page_url()
{
    boost::filesystem::path p = boost::filesystem::path(resources_dir()) / "web" / "multiace" / "index.html";
    return wxString("file://") + wxString::FromUTF8(p.make_preferred().string().c_str());
}

// Poll Moonraker (Klipper) over HTTP for temperatures + print status. Worker-safe
// (only Http, no GUI). Returns a compact object, or null on failure.
nlohmann::json fetch_machine_json(const std::string& host)
{
    const std::string url = "http://" + host + ":7125/printer/objects/query?extruder&extruder1&extruder2&extruder3&heater_bed&temperature_sensor%20cavity&print_stats&display_status&fan&gcode_move&led%20cavity_led";
    nlohmann::json out; // null unless we get a good body
    Http::get(url)
        .timeout_connect(3)
        .timeout_max(6)
        .on_error([](std::string, std::string, unsigned) {})
        .on_complete([&](std::string body, unsigned) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, false);
            if (!doc.is_object() || !doc.contains("result") || !doc["result"].contains("status"))
                return;
            const nlohmann::json& s = doc["result"]["status"];
            nlohmann::json m;
            nlohmann::json exs = nlohmann::json::array();
            for (const char* k : {"extruder", "extruder1", "extruder2", "extruder3"}) {
                if (s.contains(k) && s[k].is_object()) {
                    const nlohmann::json& e = s[k];
                    exs.push_back({{"t", e.value("temperature", 0.0)},
                                   {"target", e.value("target", 0.0)},
                                   {"active", e.value("active_pin", false)}});
                }
            }
            m["extruders"] = exs;
            if (s.contains("heater_bed") && s["heater_bed"].is_object())
                m["bed"] = {{"t", s["heater_bed"].value("temperature", 0.0)},
                            {"target", s["heater_bed"].value("target", 0.0)}};
            if (s.contains("temperature_sensor cavity") && s["temperature_sensor cavity"].is_object())
                m["chamber"] = {{"t", s["temperature_sensor cavity"].value("temperature", 0.0)}};
            nlohmann::json pr;
            if (s.contains("print_stats") && s["print_stats"].is_object()) {
                const nlohmann::json& p = s["print_stats"];
                pr["state"]   = p.value("state", std::string());
                pr["file"]    = p.value("filename", std::string());
                pr["elapsed"] = p.value("print_duration", 0.0);
            }
            if (s.contains("display_status") && s["display_status"].is_object())
                pr["progress"] = s["display_status"].value("progress", 0.0);
            m["print"] = pr;
            if (s.contains("fan") && s["fan"].is_object())
                m["fan"] = s["fan"].value("speed", 0.0);
            if (s.contains("gcode_move") && s["gcode_move"].is_object())
                m["speed"] = s["gcode_move"].value("speed_factor", 1.0);
            if (s.contains("led cavity_led") && s["led cavity_led"].is_object()) {
                bool                  on  = false;
                const nlohmann::json& led = s["led cavity_led"];
                if (led.contains("color_data") && led["color_data"].is_array())
                    for (const auto& ch : led["color_data"])
                        if (ch.is_array())
                            for (const auto& v : ch)
                                if (v.is_number() && v.get<double>() > 0.001)
                                    on = true;
                m["led"] = on;
            }
            out = m;
        })
        .perform_sync();
    return out;
}

// All enabled webcams Moonraker knows about -> [{name,url}]. Worker-safe.
nlohmann::json fetch_cams(const std::string& host)
{
    nlohmann::json arr = nlohmann::json::array();
    Http::get("http://" + host + ":7125/server/webcams/list")
        .timeout_connect(3)
        .timeout_max(6)
        .on_error([](std::string, std::string, unsigned) {})
        .on_complete([&](std::string body, unsigned) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, false);
            if (!doc.is_object() || !doc.contains("result") || !doc["result"].contains("webcams"))
                return;
            const nlohmann::json& cams = doc["result"]["webcams"];
            if (!cams.is_array())
                return;
            for (const nlohmann::json& w : cams) {
                if (!w.is_object())
                    continue;
                if (w.contains("enabled") && w["enabled"].is_boolean() && !w["enabled"].get<bool>())
                    continue;
                const std::string snap = w.value("snapshot_url", std::string());
                if (snap.empty())
                    continue;
                const std::string snapUrl = (snap.rfind("http", 0) == 0) ? snap : ("http://" + host + snap);
                // camera-streamer serves MJPEG at "<dir>/stream" (same dir as the
                // snapshot) — a live <img> feed, much smoother than polling JPEGs.
                std::string streamUrl = snapUrl;
                if (snap.rfind("http", 0) != 0) {
                    const size_t sl = snap.find_last_of('/');
                    streamUrl = "http://" + host + (sl != std::string::npos ? snap.substr(0, sl + 1) : "/") + "stream";
                }
                arr.push_back({{"name", w.value("name", std::string("cam"))}, {"snapshot", snapUrl}, {"stream", streamUrl}});
            }
        })
        .perform_sync();
    return arr;
}

std::string url_encode(const std::string& s)
{
    static const char* hex = "0123456789ABCDEF";
    std::string        o;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '/' || c == '~')
            o += char(c);
        else {
            o += '%';
            o += hex[c >> 4];
            o += hex[c & 0xF];
        }
    }
    return o;
}

// Largest gcode thumbnail URL for a file, via Moonraker metadata ("" if none).
std::string fetch_thumb(const std::string& host, const std::string& path)
{
    std::string thumb;
    Http::get("http://" + host + ":7125/server/files/metadata?filename=" + url_encode(path))
        .timeout_connect(3)
        .timeout_max(6)
        .on_error([](std::string, std::string, unsigned) {})
        .on_complete([&](std::string body, unsigned) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, false);
            if (!doc.is_object() || !doc.contains("result") || !doc["result"].contains("thumbnails"))
                return;
            const nlohmann::json& ths = doc["result"]["thumbnails"];
            if (!ths.is_array() || ths.empty())
                return;
            const nlohmann::json* best = nullptr;
            int                   bw   = -1;
            for (const nlohmann::json& t : ths) {
                const int w = t.value("width", 0);
                if (w > bw) { bw = w; best = &t; }
            }
            if (!best)
                return;
            const std::string rel = best->value("relative_path", std::string());
            if (rel.empty())
                return;
            const size_t      sl  = path.find_last_of('/');
            const std::string dir = (sl != std::string::npos) ? path.substr(0, sl + 1) : std::string();
            thumb = "http://" + host + ":7125/server/files/gcodes/" + url_encode(dir + rel);
        })
        .perform_sync();
    return thumb;
}

// The U1's gcode files -> [{name,path,modified,thumb}], newest first. Worker-safe.
nlohmann::json fetch_files(const std::string& host)
{
    nlohmann::json arr = nlohmann::json::array();
    Http::get("http://" + host + ":7125/server/files/list?root=gcodes")
        .timeout_connect(3)
        .timeout_max(8)
        .on_error([](std::string, std::string, unsigned) {})
        .on_complete([&](std::string body, unsigned) {
            const nlohmann::json doc = nlohmann::json::parse(body, nullptr, false);
            if (!doc.is_object() || !doc.contains("result") || !doc["result"].is_array())
                return;
            for (const nlohmann::json& f : doc["result"]) {
                if (!f.is_object())
                    continue;
                const std::string path = f.value("path", std::string());
                if (path.empty())
                    continue;
                std::string  name  = path;
                const size_t slash = name.find_last_of('/');
                if (slash != std::string::npos)
                    name = name.substr(slash + 1);
                arr.push_back({{"name", name}, {"path", path}, {"modified", f.value("modified", 0.0)}});
            }
            std::sort(arr.begin(), arr.end(), [](const nlohmann::json& a, const nlohmann::json& b) {
                return a.value("modified", 0.0) > b.value("modified", 0.0);
            });
        })
        .perform_sync();
    // Add a thumbnail for the newest files (bounded: one metadata request each).
    const size_t kThumbCap = 60;
    for (size_t i = 0; i < arr.size() && i < kThumbCap; ++i)
        arr[i]["thumb"] = fetch_thumb(host, arr[i].value("path", std::string()));
    return arr;
}

// Extract a human error from a Moonraker gcode/print response ("" if none).
std::string response_error(const nlohmann::json& resp)
{
    if (!resp.is_object() || !resp.contains("error") || resp["error"].is_null())
        return {};
    const nlohmann::json& e = resp["error"];
    if (e.is_string())
        return e.get<std::string>();
    if (e.is_object() && e.contains("message") && e["message"].is_string())
        return e["message"].get<std::string>();
    return e.dump();
}

// Serialise the ACE snapshot + machine state for the page. Pure (no GUI/network).
std::string serialize_state(const Slic3r::AceMmu::AceSnapshot& snap, bool fetched, bool dark, const nlohmann::json& machine,
                            const nlohmann::json& cams)
{
    nlohmann::json j;
    j["dark"]      = dark;
    j["mode"]      = snap.mode;
    j["connected"] = fetched;
    if (!machine.is_null())
        j["machine"] = machine;
    if (cams.is_array() && !cams.empty())
        j["cams"] = cams;

    j["toolheads"] = nlohmann::json::array();
    for (const auto& t : snap.toolheads) {
        nlohmann::json o;
        o["idx"]               = t.idx;
        o["material"]          = t.material;
        o["color"]             = t.color_rrggbb;
        o["brand"]             = std::string();
        o["source"]            = t.source;
        o["filament_detected"] = t.filament_detected;
        o["feeder"]            = t.feeder;
        o["ace"]               = t.ace.has_value() ? nlohmann::json(t.ace.value()) : nlohmann::json(nullptr);
        j["toolheads"].push_back(std::move(o));
    }

    j["units"] = nlohmann::json::array();
    for (const auto& u : snap.units) {
        nlohmann::json o;
        o["idx"]       = u.idx;
        o["protocol"]  = u.protocol;
        o["connected"] = u.connected;
        o["humidity"]  = u.humidity ? nlohmann::json(*u.humidity) : nlohmann::json(nullptr);
        o["temp"]      = u.temp ? nlohmann::json(*u.temp) : nlohmann::json(nullptr);
        o["dryer_min"] = u.dryer_remaining_minutes.value_or(0);
        o["slots"]     = nlohmann::json::array();
        for (const auto& s : u.slots) {
            nlohmann::json so;
            so["idx"]      = s.idx;
            so["occupied"] = s.occupied;
            so["material"] = s.material;
            so["color"]    = s.color_rrggbb;
            so["brand"]    = s.brand;
            so["source"]   = s.source;
            o["slots"].push_back(std::move(so));
        }
        j["units"].push_back(std::move(o));
    }
    return j.dump();
}
} // namespace

AceMmuPanel::AceMmuPanel(wxWindow* parent, MachineObject* obj) : wxPanel(parent, wxID_ANY), m_obj(obj)
{
    wxBoxSizer* top = new wxBoxSizer(wxVERTICAL);
    SetSizer(top);
    m_web = WebView::CreateWebView(this, page_url());
    if (m_web == nullptr) {
        BOOST_LOG_TRIVIAL(error) << "AceMmuPanel: could not create webview";
        return;
    }
    top->Add(m_web, 1, wxEXPAND);

    m_web->Bind(wxEVT_WEBVIEW_LOADED, [this](wxWebViewEvent&) {
        m_loaded = true;
        if (m_pending.empty())
            push_state();
        else
            WebView::RunScript(m_web, "window.setAceState(" + m_pending + ")");
    });

    // The page posts via window.wx.postMessage(msg) — the "wx" handler that
    // CreateWebView already registers (do NOT add another handler; that races with
    // its deferred registration and crashes). "refresh" re-pulls the inventory; write
    // actions are logged for now (the multiACE control endpoint is not wired yet).
    m_web->Bind(wxEVT_WEBVIEW_SCRIPT_MESSAGE_RECEIVED, [this](wxWebViewEvent& e) {
        const std::string msg = e.GetString().ToStdString();
        if (msg == "refresh")
            push_state();
        else if (msg == "files")
            request_files();
        else if (msg.rfind("gcode:", 0) == 0)
            send_gcode(msg.substr(6));
        else if (msg.rfind("print:", 0) == 0)
            start_print(msg.substr(6));
        else
            BOOST_LOG_TRIVIAL(info) << "AceMmuPanel: page action '" << msg << "'";
    }, m_web->GetId());

    // Live updates: poll while the tab is actually on screen.
    m_poll.SetOwner(this);
    Bind(wxEVT_TIMER, [this](wxTimerEvent&) {
        if (m_loaded && IsShownOnScreen())
            push_state();
    });
    m_poll.Start(2000);
}

AceMmuPanel::~AceMmuPanel()
{
    *m_alive = false; // neutralise any in-flight worker's CallAfter
    m_poll.Stop();
}

void AceMmuPanel::refresh() { push_state(); }

void AceMmuPanel::send_gcode(const std::string& script)
{
    std::shared_ptr<PrintHost> host;
    wxGetApp().get_connect_host(host);
    if (!host) {
        BOOST_LOG_TRIVIAL(warning) << "AceMmuPanel: no connected host for gcode '" << script << "'";
        return;
    }
    BOOST_LOG_TRIVIAL(info) << "AceMmuPanel: send gcode '" << script << "'";
    auto alive = m_alive;
    host->async_send_gcodes({script}, [this, alive](const nlohmann::json& resp) {
        const std::string err = response_error(resp);
        if (err.empty())
            return;
        wxGetApp().CallAfter([this, alive, err]() {
            if (!*alive)
                return;
            if (m_web && m_loaded)
                WebView::RunScript(m_web, "window.showError(" + nlohmann::json(err).dump() + ")");
        });
    });
}

void AceMmuPanel::request_files()
{
    std::string host = AceMmuProvider::resolve_connected_host();
    if (host.empty() && m_obj)
        host = m_obj->dev_ip;
    if (host.empty())
        return;
    auto alive = m_alive;
    std::thread([this, host, alive]() {
        const std::string j = fetch_files(host).dump();
        wxGetApp().CallAfter([this, alive, j]() {
            if (!*alive)
                return;
            if (m_web && m_loaded)
                WebView::RunScript(m_web, "window.setFiles(" + j + ")");
        });
    }).detach();
}

void AceMmuPanel::start_print(const std::string& filename)
{
    std::shared_ptr<PrintHost> host;
    wxGetApp().get_connect_host(host);
    if (!host) {
        BOOST_LOG_TRIVIAL(warning) << "AceMmuPanel: no connected host to print '" << filename << "'";
        return;
    }
    BOOST_LOG_TRIVIAL(info) << "AceMmuPanel: start print '" << filename << "'";
    auto alive = m_alive;
    host->async_start_print_job(filename, [this, alive](const nlohmann::json& resp) {
        const std::string err = response_error(resp);
        wxGetApp().CallAfter([this, alive, err]() {
            if (!*alive)
                return;
            if (!err.empty() && m_web && m_loaded)
                WebView::RunScript(m_web, "window.showError(" + nlohmann::json(err).dump() + ")");
            else
                push_state(); // reflect the newly started job
        });
    });
}

void AceMmuPanel::push_state()
{
    if (m_fetching.exchange(true))
        return; // a fetch is already in flight; skip this tick

    // Resolve host + theme on the UI thread (touch GUI state here, not in the worker).
    std::string host = AceMmuProvider::resolve_connected_host();
    if (host.empty() && m_obj)
        host = m_obj->dev_ip;
    const bool dark  = GUI_App::dark_mode();
    auto       alive = m_alive;

    std::thread([this, host, dark, alive]() {
        Slic3r::AceMmu::AceSnapshot snap;
        bool                        fetched = false;
        if (!host.empty()) {
            AceMmuProvider prov(host);
            fetched = prov.fetch_once();
            if (fetched)
                snap = prov.snapshot();
        }
        nlohmann::json machine = host.empty() ? nlohmann::json() : fetch_machine_json(host);
        nlohmann::json cams    = host.empty() ? nlohmann::json::array() : fetch_cams(host);
        std::string    json    = serialize_state(snap, fetched, dark, machine, cams);

        wxGetApp().CallAfter([this, alive, snap, fetched, json]() {
            if (!*alive)
                return; // panel destroyed; do not touch `this`
            m_fetching = false;
            if (m_obj && !snap.units.empty())
                m_obj->apply_ace_snapshot(snap);
            m_pending = wxString::FromUTF8(json.c_str());
            if (m_loaded && m_web)
                WebView::RunScript(m_web, "window.setAceState(" + m_pending + ")");
        });
    }).detach();
}

}} // namespace Slic3r::GUI
