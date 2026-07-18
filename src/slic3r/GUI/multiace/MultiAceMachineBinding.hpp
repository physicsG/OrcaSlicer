#ifndef slic3r_MultiAceMachineBinding_hpp_
#define slic3r_MultiAceMachineBinding_hpp_

#include "libslic3r/FilamentSourceBinding.hpp"
#include "slic3r/GUI/multiace/MultiAceMachineModel.hpp"

#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace Slic3r::MultiAce {

// Owner-thread RAII session joining a filament source provider to one
// MachineObject's inherited AMS model. The dispatcher must marshal work to the
// same thread on which this object is created and destroyed.
class MultiAceMachineBinding
{
public:
    using Dispatcher = FilamentSourceBinding::Dispatcher;

    MultiAceMachineBinding(MachineObject& machine, std::shared_ptr<FilamentSourceProvider> provider, Dispatcher dispatcher)
        : m_model(machine)
        , m_binding(std::move(provider), std::move(dispatcher), [this](const InventorySnapshot& snapshot) { m_model.apply(snapshot); })
    {}

    ~MultiAceMachineBinding()
    {
        m_binding.detach();
        try {
            m_model.clear();
        } catch (...) {}
    }

    MultiAceMachineBinding(const MultiAceMachineBinding&)            = delete;
    MultiAceMachineBinding& operator=(const MultiAceMachineBinding&) = delete;
    MultiAceMachineBinding(MultiAceMachineBinding&&)                 = delete;
    MultiAceMachineBinding& operator=(MultiAceMachineBinding&&)      = delete;

    void detach()
    {
        if (m_detached)
            return;
        m_binding.detach();
        m_model.clear();
        m_detached = true;
    }

    bool detached() const { return m_detached || m_binding.detached(); }

    std::string last_error() const { return m_binding.last_error(); }

    std::shared_ptr<FilamentSourceProvider> provider() const { return m_binding.provider(); }

    const AmsSourceMetadata* source_metadata(const std::string& ams_id, const std::string& tray_id) const
    {
        return m_model.source_metadata(ams_id, tray_id);
    }

    std::optional<AmsSourceSlot> slot_for_source(const SourceId& source) const { return m_model.slot_for_source(source); }

    const std::string& revision() const { return m_model.revision(); }

private:
    // m_binding must be destroyed before m_model so callbacks are fully detached
    // before the model releases its owned Ams/AmsTray objects.
    MultiAceMachineModel  m_model;
    FilamentSourceBinding m_binding;
    bool                  m_detached = false;
};

} // namespace Slic3r::MultiAce

#endif // slic3r_MultiAceMachineBinding_hpp_
