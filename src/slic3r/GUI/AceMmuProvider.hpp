#ifndef slic3r_AceMmuProvider_hpp_
#define slic3r_AceMmuProvider_hpp_

// Slicer-side provider that polls a Snapmaker U1's printer-side multiACE service
// (REST `/multiace/api/state`) and keeps a fresh AceSnapshot.
//
// Phase 1 (this file): connect, poll on a worker thread, and cache the latest
// good snapshot. Projecting the snapshot onto MachineObject::amsList and the
// GUI-thread refresh signalling come in Phase 2 (see docs/ace-mmu/).

#include "libslic3r/AceMmuState.hpp"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>

namespace Slic3r { namespace GUI {

class AceMmuProvider
{
public:
    // `host` is the printer IP/hostname, e.g. "192.168.2.242"; the base URL is
    // built as http://<host>/multiace. Plain HTTP mirrors multiACE's own
    // post-processor and works unauthenticated on stock installs
    // (see docs/ace-mmu/02-multiace-printer-api.md §2.1).
    explicit AceMmuProvider(std::string host, int poll_interval_s = 3);
    ~AceMmuProvider();

    AceMmuProvider(const AceMmuProvider&)            = delete;
    AceMmuProvider& operator=(const AceMmuProvider&) = delete;

    // Start/stop the background poll worker. Both are idempotent; stop() joins.
    void start();
    void stop();
    bool is_running() const { return m_running.load(); }

    // Thread-safe copy of the most recent good snapshot.
    AceMmu::AceSnapshot snapshot() const;

    // Monotonic counter, bumped on every successful fetch; lets callers detect a
    // refresh without comparing whole snapshots.
    uint64_t revision() const { return m_revision.load(); }

    // Fetch and parse `/api/state` once, synchronously (this is what the worker
    // calls each tick). Returns true and replaces the cached snapshot only on a
    // well-formed response; a transient/failed/garbage read keeps the last good
    // snapshot (docs 04 §4.7).
    bool fetch_once();

    const std::string& base_url() const { return m_base_url; }

    // Best-effort IP/host of the currently-connected printer: the selected
    // MachineObject's dev_ip if set, else parsed from the connected PrintHost
    // (the U1 connects as a PrintHost via the webview, not a MachineObject).
    // Empty if nothing is connected.
    static std::string resolve_connected_host();

private:
    void run();

    std::string m_host;
    std::string m_base_url;
    int         m_poll_interval_s;

    mutable std::mutex    m_mutex;    // guards m_snapshot
    AceMmu::AceSnapshot   m_snapshot; // last good
    std::atomic<uint64_t> m_revision{0};

    std::thread             m_worker;
    std::atomic<bool>       m_running{false};
    std::mutex              m_wait_mutex; // pairs with m_wait_cv for the poll sleep
    std::condition_variable m_wait_cv;
};

}} // namespace Slic3r::GUI

#endif // slic3r_AceMmuProvider_hpp_
