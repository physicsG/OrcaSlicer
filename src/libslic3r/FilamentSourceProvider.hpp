#ifndef slic3r_FilamentSourceProvider_hpp_
#define slic3r_FilamentSourceProvider_hpp_

#include "MultiAceInventory.hpp"

#include <deque>
#include <exception>
#include <functional>
#include <mutex>
#include <utility>
#include <vector>

namespace Slic3r::MultiAce {

class FilamentSourceProvider
{
public:
    using InventoryCallback = std::function<void(const InventorySnapshot&)>;

    virtual ~FilamentSourceProvider() = default;

    virtual ProviderCapabilities capabilities() const                             = 0;
    virtual InventorySnapshot    inventory() const                                = 0;
    virtual void                 subscribe(InventoryCallback callback)            = 0;
    virtual void                 request_metadata_refresh(const SourceId& source) = 0;
};

// Transport-independent provider used for offline/manual operation, tests, and
// as a stable seam while the Moonraker HTTP/WebSocket client is connected in a
// later implementation slice.
class ManualFilamentSourceProvider final : public FilamentSourceProvider
{
public:
    using RefreshCallback = std::function<void(const SourceId&)>;

    explicit ManualFilamentSourceProvider(ProviderCapabilities capabilities = {}, InventorySnapshot inventory = {})
        : m_capabilities(std::move(capabilities)), m_inventory(std::move(inventory))
    {}

    ProviderCapabilities capabilities() const override
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_capabilities;
    }

    InventorySnapshot inventory() const override
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        return m_inventory;
    }

    void subscribe(InventoryCallback callback) override
    {
        if (!callback)
            return;
        std::lock_guard<std::mutex> lock(m_mutex);
        m_inventory_callbacks.emplace_back(std::move(callback));
    }

    void request_metadata_refresh(const SourceId& source) override
    {
        RefreshCallback callback;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            callback = m_refresh_callback;
        }
        if (callback)
            callback(source);
    }

    void set_capabilities(ProviderCapabilities capabilities)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_capabilities = std::move(capabilities);
    }

    void set_inventory(InventorySnapshot inventory)
    {
        bool dispatch_notifications = false;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_inventory = std::move(inventory);
            m_pending_inventory.emplace_back(m_inventory);
            if (!m_dispatching_inventory) {
                m_dispatching_inventory = true;
                dispatch_notifications  = true;
            }
        }

        if (dispatch_notifications)
            dispatch_inventory_notifications();
    }

    void set_refresh_callback(RefreshCallback callback)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_refresh_callback = std::move(callback);
    }

private:
    void dispatch_inventory_notifications()
    {
        std::exception_ptr first_failure;

        for (;;) {
            InventorySnapshot              snapshot;
            std::vector<InventoryCallback> callbacks;
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                if (m_pending_inventory.empty()) {
                    m_dispatching_inventory = false;
                    break;
                }

                snapshot = std::move(m_pending_inventory.front());
                m_pending_inventory.pop_front();
                callbacks = m_inventory_callbacks;
            }

            for (const InventoryCallback& callback : callbacks) {
                try {
                    callback(snapshot);
                } catch (...) {
                    if (!first_failure)
                        first_failure = std::current_exception();
                }
            }
        }

        if (first_failure)
            std::rethrow_exception(first_failure);
    }

    mutable std::mutex             m_mutex;
    ProviderCapabilities           m_capabilities;
    InventorySnapshot              m_inventory;
    std::vector<InventoryCallback> m_inventory_callbacks;
    RefreshCallback                m_refresh_callback;
    std::deque<InventorySnapshot>  m_pending_inventory;
    bool                           m_dispatching_inventory = false;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_FilamentSourceProvider_hpp_
