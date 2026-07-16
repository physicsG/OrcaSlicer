#ifndef slic3r_FilamentSourceProvider_hpp_
#define slic3r_FilamentSourceProvider_hpp_

#include "MultiAceInventory.hpp"

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
        std::vector<InventoryCallback> callbacks;
        {
            std::lock_guard<std::mutex> lock(m_mutex);
            m_inventory = std::move(inventory);
            callbacks   = m_inventory_callbacks;
        }

        const InventorySnapshot snapshot = this->inventory();
        for (const InventoryCallback& callback : callbacks)
            callback(snapshot);
    }

    void set_refresh_callback(RefreshCallback callback)
    {
        std::lock_guard<std::mutex> lock(m_mutex);
        m_refresh_callback = std::move(callback);
    }

private:
    mutable std::mutex             m_mutex;
    ProviderCapabilities           m_capabilities;
    InventorySnapshot              m_inventory;
    std::vector<InventoryCallback> m_inventory_callbacks;
    RefreshCallback                m_refresh_callback;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_FilamentSourceProvider_hpp_
