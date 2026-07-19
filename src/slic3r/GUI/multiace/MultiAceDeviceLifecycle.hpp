#ifndef slic3r_MultiAceDeviceLifecycle_hpp_
#define slic3r_MultiAceDeviceLifecycle_hpp_

#include "MultiAcePrinterLifecycle.hpp"
#include "MultiAceProviderActivation.hpp"

#include <optional>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

// DeviceManager-facing adapter for per-printer lifecycle reconciliation. The
// caller supplies the persisted JSON from Orca's printer settings surface when
// a machine is discovered or settings are reloaded.
class MultiAceDeviceLifecycle
{
public:
    explicit MultiAceDeviceLifecycle(DeviceManager& device_manager) : m_device_manager(device_manager) {}

    PrinterLifecycleAction reconcile(const std::string&                machine_id,
                                     MachineObject&                    machine,
                                     const std::optional<nlohmann::json>& persisted_value,
                                     DeviceManager::MultiAceDispatcher dispatcher = {})
    {
        return m_lifecycle.reconcile(
            machine_id,
            persisted_value,
            [&](const std::string&, const ProviderActivationConfig& config) {
                activate_multiace_web_provider(m_device_manager, machine, config, dispatcher);
            },
            [&](const std::string&) { m_device_manager.detach_multiace_provider(machine); });
    }

    PrinterLifecycleAction forget(const std::string& machine_id, MachineObject& machine)
    {
        return m_lifecycle.forget(machine_id, [&](const std::string&) { m_device_manager.detach_multiace_provider(machine); });
    }

    bool is_tracked(const std::string& machine_id) const noexcept { return m_lifecycle.is_tracked(machine_id); }
    std::size_t size() const noexcept { return m_lifecycle.size(); }

private:
    DeviceManager&             m_device_manager;
    MultiAcePrinterLifecycle   m_lifecycle;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceDeviceLifecycle_hpp_
