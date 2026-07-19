#ifndef slic3r_MultiAcePrinterLifecycle_hpp_
#define slic3r_MultiAcePrinterLifecycle_hpp_

#include "MultiAcePrinterConfig.hpp"

#include <map>
#include <optional>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

enum class PrinterLifecycleAction {
    Unchanged,
    Activated,
    Detached,
    InvalidConfig,
};

// Reconciles persisted per-printer configuration with the currently active
// provider binding. Provider construction/attachment and persistence I/O stay
// outside this GUI-independent helper so the same behavior is deterministic in
// tests and in DeviceManager discovery/settings callbacks.
template<class MachineKey> class BasicMultiAcePrinterLifecycle
{
public:
    template<class Activate, class Detach>
    PrinterLifecycleAction reconcile(const MachineKey&                    machine_key,
                                     const std::optional<nlohmann::json>& persisted_value,
                                     Activate&&                           activate,
                                     Detach&&                             detach)
    {
        if (!persisted_value)
            return detach_if_tracked(machine_key, std::forward<Detach>(detach));

        PersistedProviderConfig persisted;
        try {
            persisted = parse_persisted_provider_config(*persisted_value);
        } catch (...) {
            detach_if_tracked(machine_key, std::forward<Detach>(detach));
            return PrinterLifecycleAction::InvalidConfig;
        }

        const auto activation = provider_activation_config_if_enabled(persisted);
        if (!activation)
            return detach_if_tracked(machine_key, std::forward<Detach>(detach));

        const std::string fingerprint = serialize_persisted_provider_config(persisted).dump();
        const auto        current     = m_active_fingerprints.find(machine_key);
        if (current != m_active_fingerprints.end() && current->second == fingerprint)
            return PrinterLifecycleAction::Unchanged;

        // Activation is intentionally attempted before updating bookkeeping.
        // The concrete activation helper starts the replacement provider before
        // DeviceManager detaches the old binding. If activation fails, retaining
        // the old fingerprint makes the same configuration eligible for retry.
        std::forward<Activate>(activate)(machine_key, *activation);
        m_active_fingerprints[machine_key] = fingerprint;
        return PrinterLifecycleAction::Activated;
    }

    template<class Detach> PrinterLifecycleAction forget(const MachineKey& machine_key, Detach&& detach)
    {
        return detach_if_tracked(machine_key, std::forward<Detach>(detach));
    }

    template<class Detach> void clear(Detach&& detach) noexcept
    {
        while (!m_active_fingerprints.empty()) {
            const MachineKey machine_key = m_active_fingerprints.begin()->first;
            m_active_fingerprints.erase(m_active_fingerprints.begin());
            try {
                detach(machine_key);
            } catch (...) {}
        }
    }

    bool is_tracked(const MachineKey& machine_key) const noexcept
    {
        return m_active_fingerprints.find(machine_key) != m_active_fingerprints.end();
    }

    std::size_t size() const noexcept { return m_active_fingerprints.size(); }

private:
    template<class Detach> PrinterLifecycleAction detach_if_tracked(const MachineKey& machine_key, Detach&& detach)
    {
        const auto current = m_active_fingerprints.find(machine_key);
        if (current == m_active_fingerprints.end())
            return PrinterLifecycleAction::Unchanged;

        // Remove bookkeeping first so a throwing detach cannot leave a stale
        // configuration marked active. DeviceManager's detach path is noexcept,
        // but keeping this helper defensive makes failure behavior deterministic.
        m_active_fingerprints.erase(current);
        std::forward<Detach>(detach)(machine_key);
        return PrinterLifecycleAction::Detached;
    }

    std::map<MachineKey, std::string> m_active_fingerprints;
};

using MultiAcePrinterLifecycle = BasicMultiAcePrinterLifecycle<std::string>;

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAcePrinterLifecycle_hpp_
